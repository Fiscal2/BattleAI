import { createReadStream } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import argon2 from "argon2";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import { ensureLoop, presentEvent, viewFor, type Completer } from "../match/runner.js";
import { modelEnv, type ModelEnv } from "../model/client.js";
import { gameById, isGameId } from "../rules/index.js";
import type { GameId, Seat } from "../rules/types.js";
import type { Coach, EventRow, Store } from "../store/db.js";
import { escapeHtml, field, page, replayControls } from "./page.js";
import { gameGraphic } from "./graphics.js";
import { resumeCursor } from "./cursor.js";
import { positionAt } from "../match/position.js";
import { agentEditor } from "./agent-page.js";
import { rankingsBody } from "./rankings-page.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const fonts: Record<string, string> = {
  "geist-400.woff2": "geist-latin-400-normal.woff2",
  "geist-500.woff2": "geist-latin-500-normal.woff2",
  "geist-600.woff2": "geist-latin-600-normal.woff2",
  "geist-700.woff2": "geist-latin-700-normal.woff2",
  "geist-mono-400.woff2": "geist-mono-latin-400-normal.woff2",
};

const labels: Record<GameId, string> = {
  tictactoe: "Tic-tac-toe",
  four: "Four in a Row",
  checkers: "Checkers",
  fleet: "Fleet",
};

export type Hub = {
  publish(matchId: string, event: EventRow): void;
  subscribe(matchId: string, listener: (event: EventRow) => void): () => void;
};

type RunnerState = "running" | "stopped" | "unconfigured";

export function createHub(): Hub {
  const listeners = new Map<string, Set<(event: EventRow) => void>>();
  return {
    publish(matchId, event) {
      for (const listener of listeners.get(matchId) ?? []) listener(event);
    },
    subscribe(matchId, listener) {
      const set = listeners.get(matchId) ?? new Set();
      set.add(listener);
      listeners.set(matchId, set);
      return () => set.delete(listener);
    },
  };
}

export function createApp(input: { store: Store; env: NodeJS.ProcessEnv; complete: Completer; hub?: Hub }) {
  const app = Fastify({ logger: { level: "error" } });
  const hub = input.hub ?? createHub();
  const running = new Map<string, Promise<void>>();
  const stopped = new Set<string>();
  const runnerListeners = new Map<string, Set<(state: RunnerState) => void>>();
  const configured = () => modelEnv(input.env) !== null;
  const runnerState = (id: string): RunnerState => !configured() ? "unconfigured" : stopped.has(id) ? "stopped" : "running";
  const notifyRunner = (id: string, state: RunnerState) => {
    for (const listener of runnerListeners.get(id) ?? []) listener(state);
  };
  const loop = (matchId: string) => {
    if (!configured() || running.has(matchId) || input.store.getMatch(matchId)?.status !== "active") return;
    stopped.delete(matchId);
    ensureLoop({
      store: input.store,
      gameFor: (id) => gameById(id)!,
      complete: input.complete,
      configured: configured(),
      running,
      matchId,
      afterEvent: (event) => hub.publish(matchId, event),
      onError: () => {
        stopped.add(matchId);
        app.log.error({ matchId }, "Match runner stopped; refresh to retry.");
        notifyRunner(matchId, "stopped");
      },
    });
    notifyRunner(matchId, "running");
  };
  const renderMatch = (id: string, coach: Coach | undefined, error = "") =>
    matchPage(input.store, id, coach, error, input.store.getMatch(id)?.status === "active" ? runnerState(id) : undefined);

  app.removeContentTypeParser("application/json");
  app.addContentTypeParser("application/json", { parseAs: "string" }, (_request, body, done) => {
    try {
      done(null, JSON.parse(body as string));
    } catch (error) {
      done(error as Error, undefined);
    }
  });
  app.addContentTypeParser(
    "application/x-www-form-urlencoded",
    { parseAs: "string" },
    (_request, body, done) => {
      done(null, Object.fromEntries(new URLSearchParams(body as string)));
    },
  );

  function coachOf(request: FastifyRequest): Coach | undefined {
    const header = request.headers.cookie;
    if (!header) return undefined;
    for (const part of header.split(";")) {
      const [name, ...rest] = part.trim().split("=");
      if (name === "session") return input.store.coachForSession(decodeURIComponent(rest.join("=")));
    }
    return undefined;
  }

  function setSession(reply: FastifyReply, id: string) {
    reply.header("set-cookie", `session=${encodeURIComponent(id)}; HttpOnly; SameSite=Lax; Path=/`);
  }

  function requireCoach(request: FastifyRequest, reply: FastifyReply): Coach | undefined {
    const coach = coachOf(request);
    if (!coach) {
      if (request.method === "GET") reply.redirect("/login");
      else reply.code(401).send("Sign in required.");
    }
    return coach;
  }

  app.get("/", async (request, reply) => {
    reply.redirect(coachOf(request) ? "/matches" : "/login");
  });

  app.get("/app.css", async (_request, reply) => {
    reply.type("text/css").send(await readFile(join(root, "public/app.css")));
  });
  app.get("/client.js", async (_request, reply) => {
    reply.type("text/javascript").send(await readFile(join(root, "public/client.js")));
  });
  app.get("/fonts/:file", async (request, reply) => {
    const file = fonts[(request.params as { file: string }).file];
    if (!file) return reply.code(404).send("Not found.");
    const path = file.startsWith("geist-mono")
      ? join(root, "public/fonts", file)
      : join(root, "public/fonts", file);
    reply.type("font/woff2");
    return reply.send(createReadStream(path));
  });

  app.get("/register", async (_request, reply) => {
    reply.type("text/html").send(authPage("Create a coach", "/register", "Register"));
  });
  app.post("/register", async (request, reply) => {
    const body = request.body as Record<string, string>;
    const email = body.email ?? "";
    const displayName = (body.displayName ?? "").trim();
    const password = body.password ?? "";
    if (!email.includes("@") || displayName.length === 0 || password.length < 8) {
      return reply
        .type("text/html")
        .send(authPage("Create a coach", "/register", "Register", "Use an email, a display name, and a password of at least 8 characters."));
    }
    if (input.store.coachByEmail(email)) {
      return reply.type("text/html").send(authPage("Create a coach", "/register", "Register", "That email is already registered."));
    }
    const coach = input.store.createCoach({
      email,
      displayName,
      passwordHash: await argon2.hash(password),
    });
    setSession(reply, input.store.createSession(coach.id));
    return reply.redirect("/agent", 303);
  });

  app.get("/login", async (_request, reply) => {
    reply.type("text/html").send(authPage("Log in", "/login", "Log in"));
  });
  app.post("/login", async (request, reply) => {
    const body = request.body as Record<string, string>;
    const coach = input.store.coachByEmail(body.email ?? "");
    const password = body.password ?? "";
    if (!coach || !(await argon2.verify(coach.password_hash, password))) {
      return reply.type("text/html").send(authPage("Log in", "/login", "Log in", "Email or password is wrong."));
    }
    setSession(reply, input.store.createSession(coach.id));
    return reply.redirect("/matches", 303);
  });

  app.post("/logout", async (request, reply) => {
    const coach = requireCoach(request, reply);
    if (!coach) return;
    const header = request.headers.cookie ?? "";
    for (const part of header.split(";")) {
      const [name, ...rest] = part.trim().split("=");
      if (name === "session") input.store.deleteSession(decodeURIComponent(rest.join("=")));
    }
    reply.header("set-cookie", "session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0");
    return reply.redirect("/login", 303);
  });

  app.get("/agent", async (request, reply) => {
    const coach = requireCoach(request, reply);
    if (!coach) return;
    const agent = input.store.getAgent(coach.id);
    reply.type("text/html").send(
      page({
        title: "Agent",
        coachName: coach.display_name,
        body: agentEditor(agent, (request.query as { saved?: unknown }).saved === "1"),
      }),
    );
  });
  app.post("/agent", async (request, reply) => {
    const coach = requireCoach(request, reply);
    if (!coach) return;
    const body = request.body as Record<string, string>;
    input.store.saveAgent(coach.id, {
      persona: body.persona ?? "",
      playbook: body.playbook ?? "",
      context: body.context ?? "",
    });
    return reply.redirect("/agent?saved=1", 303);
  });

  app.get("/rankings", async (request, reply) => {
    reply.header("cache-control", "private, no-store").header("vary", "Cookie");
    const query = request.query as { game?: unknown; page?: unknown };
    const game = query.game === undefined || query.game === "all" ? undefined : query.game;
    const rawPage = query.page === undefined ? "1" : query.page;
    const pageNumber = typeof rawPage === "string" && /^[1-9]\d*$/.test(rawPage) ? Number(rawPage) : NaN;
    const offset = (pageNumber - 1) * 50;
    if ((game !== undefined && (typeof game !== "string" || !isGameId(game))) || !Number.isSafeInteger(pageNumber) || !Number.isSafeInteger(offset)) {
      return reply.code(400).type("text/html").send(page({ title: "Rankings", body: '<h1 class="page-title">Invalid ranking filter</h1><p class="body">Choose an available game and a positive whole page number.</p><a class="pill pill-ghost" href="/rankings">View Rankings</a>' }));
    }
    const coach = coachOf(request);
    const gameId = game as GameId | undefined;
    const result = input.store.rankings({ gameId, limit: 50, offset });
    if (pageNumber > Math.max(1, Math.ceil(result.total / 50))) {
      return reply.code(404).type("text/html").send(page({ title: "Rankings", coachName: coach?.display_name, body: '<h1 class="page-title">Ranking page not found</h1><p class="body">This page has no results. Return to the first page.</p><a class="pill pill-ghost" href="/rankings">View Rankings</a>' }));
    }
    return reply.type("text/html").send(page({ title: "Rankings", coachName: coach?.display_name, body: rankingsBody({ ...result, gameId, page: pageNumber, coachId: coach?.id, labels }) }));
  });

  app.get("/matches", async (request, reply) => {
    const coach = requireCoach(request, reply);
    if (!coach) return;
    const rows = input.store.record(coach.id);
    const list = rows
      .map((row) => {
        const word = row.line.split(", ").slice(2).join(", ");
        return `<a class="record" href="/matches/${row.match.id}"><span>${escapeHtml(labels[row.match.game_id])}</span><span>${escapeHtml(row.opponent)}</span><span>${escapeHtml(word)}</span></a>`;
      })
      .join("");
    reply.type("text/html").send(
      page({
        title: "Matches",
        coachName: coach.display_name,
        body: `<div class="page-heading"><h1 class="page-title">Matches</h1><p class="body">Choose a game, invite a coach, and watch your agents play.</p></div>
          <form class="panel match-create" method="post" action="/matches">
            <fieldset class="game-picker"><legend class="section-title">Choose your arena</legend>
              ${(Object.keys(labels) as GameId[]).map((gameId, index) => `<label class="game-option"><input type="radio" name="gameId" value="${gameId}"${index === 0 ? " checked" : ""}><span class="game-choice">${gameGraphic(gameId)}<span class="game-name">${labels[gameId]}</span><span class="game-description">${gameId === "fleet" ? "Hidden fleets · 10 × 10" : gameId === "checkers" ? "English draughts · 8 × 8" : gameId === "four" ? "Gravity · 7 × 6" : "Three in a line · 3 × 3"}</span><span class="choice-indicator" aria-hidden="true"></span></span></label>`).join("")}
            </fieldset>
            <div class="form-footer"><p class="body">Share the match link with your opponent.</p><button class="pill pill-primary" type="submit">Create match <span aria-hidden="true">→</span></button></div>
          </form>
          <section class="records-section"><div class="section-heading"><h2 class="section-title">Match record</h2><span class="count-badge">${rows.length}</span></div>
          <div class="records">${list || `<div class="empty-record">${gameGraphic("four")}<div><h3>No finished matches yet</h3><p class="body">Completed matches and their replays will appear here.</p></div></div>`}</div></section>`,
      }),
    );
  });

  app.post("/matches", async (request, reply) => {
    const coach = requireCoach(request, reply);
    if (!coach) return;
    const gameId = (request.body as { gameId?: string }).gameId ?? "";
    if (!isGameId(gameId)) return reply.code(400).send("Unknown game.");
    const match = input.store.createMatch(coach.id, gameId);
    return reply.redirect(`/matches/${match.id}`, 303);
  });

  app.post("/matches/:id/join", async (request, reply) => {
    const coach = requireCoach(request, reply);
    if (!coach) return;
    const id = (request.params as { id: string }).id;
    if (!configured()) {
      return reply.code(409).type("text/html").send(renderMatch(id, coach, "The model is not configured."));
    }
    const joined = input.store.joinMatch(id, coach.id);
    if (!joined.ok) return reply.code(409).type("text/html").send(renderMatch(id, coach, joined.error));
    const before = 0;
    for (const event of input.store.events(id)) {
      if (event.seq > before) hub.publish(id, event);
    }
    loop(id);
    return reply.redirect(`/matches/${id}`, 303);
  });

  app.get("/matches/:id", async (request, reply) => {
    const id = (request.params as { id: string }).id;
    if (!input.store.getMatch(id)) return reply.code(404).send("Match not found.");
    loop(id);
    reply.type("text/html").send(renderMatch(id, coachOf(request)));
  });

  app.get("/matches/:id/position", async (request, reply) => {
    const id = (request.params as { id: string }).id;
    const match = input.store.getMatch(id);
    if (!match) return reply.code(404).send({ error: "Match not found." });
    reply.header("cache-control", "private, no-store").header("vary", "Cookie");
    const raw = (request.query as { seq?: unknown }).seq;
    const seq = typeof raw === "string" && /^\d+$/.test(raw) ? Number(raw) : NaN;
    const events = input.store.parsedEvents(id);
    if (!Number.isSafeInteger(seq) || seq < 0 || seq > (events.at(-1)?.seq ?? 0)) {
      return reply.code(400).send({ error: "Choose an existing event sequence." });
    }
    return positionAt(gameById(match.game_id)!, match.first_seat, events, viewerFor(input.store, id, coachOf(request)), seq);
  });

  app.get("/matches/:id/events", async (request, reply) => {
    const id = (request.params as { id: string }).id;
    const match = input.store.getMatch(id);
    if (!match) return reply.code(404).send("Match not found.");
    const after = resumeCursor((request.query as { after?: string }).after, request.headers["last-event-id"]);
    const viewer = viewerFor(input.store, id, coachOf(request));
    const game = gameById(match.game_id)!;
    loop(id);
    reply.hijack();
    reply.raw.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });
    // An idle waiting match has no body yet; announce the live connection immediately.
    reply.raw.flushHeaders();
    const seen = new Set<number>();
    const send = (event: EventRow) => {
      if (seen.has(event.seq) || event.seq <= after) return;
      seen.add(event.seq);
      const payload = JSON.parse(event.payload_json) as Record<string, unknown>;
      const history = input.store.parsedEvents(id);
      const current = input.store.getMatch(id)!;
      const position = positionAt(game, current.first_seat, history, viewer, event.seq);
      const body = presentEvent({ seq: event.seq, type: event.type, payload }, match.game_id, viewer);
      reply.raw.write(`id: ${event.seq}\ndata: ${JSON.stringify({ event: body, view: position.view, firstSeat: position.firstSeat, names: position.names })}\n\n`);
    };
    let live = false;
    const pending: EventRow[] = [];
    const unsubscribe = hub.subscribe(id, (event) => {
      if (live) send(event);
      else pending.push(event);
    });
    const statuses = runnerListeners.get(id) ?? new Set<(state: RunnerState) => void>();
    const sendStatus = (state: RunnerState) => {
      if (!reply.raw.destroyed && !reply.raw.writableEnded) reply.raw.write(`data: ${JSON.stringify({ runner: state })}\n\n`);
    };
    statuses.add(sendStatus);
    runnerListeners.set(id, statuses);
    const cleanup = () => {
      unsubscribe();
      statuses.delete(sendStatus);
      if (statuses.size === 0) runnerListeners.delete(id);
    };
    reply.raw.on("close", cleanup);
    reply.raw.on("error", cleanup);
    if (match.status === "active") sendStatus(runnerState(id));
    for (const event of input.store.events(id)) send(event);
    live = true;
    for (const event of pending) send(event);
  });

  for (const id of input.store.activeMatchIds()) loop(id);

  return app;
}

function viewerFor(store: Store, matchId: string, coach: Coach | undefined): Seat | "spectator" {
  if (!coach) return "spectator";
  const seat = store.seats(matchId).find((row) => row.coach_id === coach.id);
  return seat ? seat.seat : "spectator";
}

function authPage(title: string, action: string, submit: string, error = ""): string {
  const email = action === "/login";
  return page({
    title,
    body: `<div class="auth-layout"><section class="auth-intro"><div class="arena-diagram" aria-hidden="true">${gameGraphic("tictactoe")}${gameGraphic("four")}${gameGraphic("checkers")}${gameGraphic("fleet")}</div>
      <h1 class="page-title">${escapeHtml(title)}</h1><p class="body">Coach your agent. Watch it compete.</p><p class="auth-note body">Four games. Two agents. Every move recorded.</p></section>
      <section class="auth-form"><h2 class="section-title">${email ? "Welcome back" : "Your place on the sideline"}</h2>
      ${error ? `<p class="error" role="alert">${escapeHtml(error)}</p>` : ""}
      <form class="form" method="post" action="${action}">
        ${field("Email", "email", "", { type: "email" })}
        ${email ? "" : field("Display name", "displayName")}
        ${field("Password", "password", "", { type: "password" })}
        ${email ? "" : '<p class="field-help">Use at least 8 characters for your password.</p>'}
        <button class="pill pill-primary" type="submit">${escapeHtml(submit)}</button>
      </form><p class="auth-switch body">${email ? 'New here? <a href="/register">Create a coach</a>' : 'Already registered? <a href="/login">Log in</a>'}</p></section></div>`,
  });
}

function matchPage(store: Store, id: string, coach: Coach | undefined, error = "", runner?: RunnerState): string {
  const match = store.getMatch(id);
  if (!match) return page({ title: "Missing", body: "<p>Match not found.</p>" });
  const seats = store.seats(id);
  const names: Record<string, string> = {};
  for (const seat of seats) names[String(seat.seat)] = store.coachById(seat.coach_id)?.display_name ?? "";
  const viewer = viewerFor(store, id, coach);
  const game = gameById(match.game_id)!;
  const parsed = store.parsedEvents(id);
  const view = viewFor(game, match.first_seat, parsed, viewer);
  const events = parsed.map((event) => presentEvent(event, match.game_id, viewer));
  const mine = coach ? seats.find((seat) => seat.coach_id === coach.id) : undefined;
  const canJoin = coach && match.status === "waiting" && !mine;
  const snapshots = seats
    .map((seat) => {
      const snap = JSON.parse(seat.snapshot_json || "{}") as {
        persona?: string;
        playbook?: string;
        context?: string;
      };
      const ready = Boolean(snap.persona || snap.playbook || snap.context);
      return `<article class="panel snapshot seat-${seat.seat}"><div class="snapshot-heading"><span class="agent-avatar" aria-hidden="true">${escapeHtml((names[String(seat.seat)] || "?").slice(0, 1))}</span><div><h3 class="card-title">${escapeHtml(names[String(seat.seat)] || "Seat")}</h3><span class="snapshot-tag">${match.status === "waiting" ? "Snapshot available at match start" : "Coaching snapshot"}</span></div></div>
        ${ready ? `<dl class="snapshot-fields"><dt>Persona</dt><dd>${escapeHtml(snap.persona || "—")}</dd><dt>Playbook</dt><dd>${escapeHtml(snap.playbook || "—")}</dd><dt>Context</dt><dd>${escapeHtml(snap.context || "—")}</dd></dl>` : `<p class="body">${match.status === "waiting" ? "Coaching will be copied when the second coach joins." : "No coaching instructions were provided."}</p>`}</article>`;
    })
    .join("");
  const boot = {
    matchId: id,
    seq: parsed.at(-1)?.seq ?? 0,
    view,
    names,
    game: match.game_id,
    status: match.status,
    firstSeat: match.first_seat,
    result: match.result ? { result: match.result, winnerSeat: match.winner_seat, forfeitSeat: match.forfeit_seat, forfeitCause: match.forfeit_cause } : null,
    runner,
  };
  const dot = `<span class="dot ${match.status}" aria-hidden="true"></span>`;
  const heading = `<span>${escapeHtml(names["0"] || "Open seat")}</span><span class="versus">vs</span><span>${escapeHtml(names["1"] || "Open seat")}</span>`;
  const participants = ([0, 1] as const).map((seat) => `<div class="participant seat-${seat}"><span class="agent-avatar" aria-hidden="true">${escapeHtml((names[String(seat)] || "?").slice(0, 1))}</span><span class="participant-name">${escapeHtml(names[String(seat)] || "Open seat")}</span><span class="participant-role">${mine?.seat === seat ? "Your agent" : "Agent " + (seat + 1)}</span></div>`).join('<span class="participant-divider" aria-hidden="true">/</span>');
  return page({
    title: labels[match.game_id],
    coachName: coach?.display_name,
    body: `<div class="match-page first-seat-${match.first_seat ?? 0}"><div class="match-toolbar"><a class="back-link" href="${coach ? "/matches" : "/login"}">← ${coach ? "Matches" : "Log in"}</a><div class="match-meta"><span class="game-badge">${gameGraphic(match.game_id)}${labels[match.game_id]}</span><span class="view-label">${viewer === "spectator" ? "Spectator view" : "Your seat"}</span></div></div>
      <div class="status-row"><h1 class="page-title match-title">${heading}</h1><p class="status-pill" role="status">${dot}<span id="match-status">${match.status === "finished" ? "Finished" : match.status === "waiting" ? "Waiting for opponent" : "In progress"}</span></p></div>
      ${error ? `<p class="error" role="alert">${escapeHtml(error)}</p>` : ""}
      ${match.status === "waiting" ? `<div class="waiting-notice"><p class="body">${canJoin ? "Take the open seat to start this match." : "Share this page’s URL with another coach to start the match."}</p>${canJoin ? `<form method="post" action="/matches/${id}/join"><button class="pill pill-primary" type="submit">Join match</button></form>` : ""}</div>` : ""}
      <div class="arena-layout"><section class="board-frame" aria-label="Game position"><div class="arena-header"><h2 class="section-title">The board</h2><span class="board-game-name">${labels[match.game_id]}</span></div><div class="participant-rail">${participants}</div>${replayControls(boot.seq)}<div id="board" class="board-stage"></div><div class="arena-footer"><span class="latest-key"><span aria-hidden="true"></span>Latest move</span><span>${match.game_id === "fleet" && viewer === "spectator" ? "Both fleets visible" : "Server-validated moves"}</span></div></section>
        <section class="activity-panel" aria-labelledby="activity-title"><div class="activity-header"><div class="section-heading"><h2 id="activity-title" class="section-title">Agent activity</h2><span id="event-count" class="count-badge">${events.length}</span></div><p id="connection-status" class="connection-status" role="status">${match.status === "finished" ? "Match complete" : "Connecting…"}</p></div><a class="mobile-board-link" href="#replay-controls">View board ↑</a><ol id="events" class="events" tabindex="0" aria-label="Agent action history"></ol></section></div>
      <section class="coaching-section"><div class="section-heading"><h2 class="section-title">Behind the moves</h2><span class="snapshot-tag">${match.status === "waiting" ? "Copied when play begins" : "Instructions at match start"}</span></div><div class="snapshots">${snapshots}</div></section></div>
      <script id="boot" type="application/json">${JSON.stringify(boot).replaceAll("<", "\\u003c")}</script>
      <script>window.__events = ${JSON.stringify(events).replaceAll("<", "\\u003c")};</script>
      <script type="module" src="/client.js"></script>`,
  });
}

export function readModel(env: NodeJS.ProcessEnv): ModelEnv | null {
  return modelEnv(env);
}
