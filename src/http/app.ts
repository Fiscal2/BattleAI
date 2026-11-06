import { createReadStream } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import argon2 from "argon2";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import { ensureLoop, viewFor, type Completer } from "../match/runner.js";
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
import { matchesBody } from "./matches-page.js";
import { timeline } from "../match/timeline.js";

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
    matchPage(input.store, id, coach, error, input.store.getMatch(id)?.status === "active" ? runnerState(id) : undefined, configured());

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

  app.get("/register", async (request, reply) => {
    reply.type("text/html").send(authPage("Create a coach", "/register", "Register", "", invitationPath((request.query as { next?: unknown }).next)));
  });
  app.post("/register", async (request, reply) => {
    const body = request.body as Record<string, string>;
    const next = invitationPath(body.next);
    const email = body.email ?? "";
    const displayName = (body.displayName ?? "").trim();
    const password = body.password ?? "";
    if (!email.includes("@") || displayName.length === 0 || password.length < 8) {
      return reply
        .type("text/html")
        .send(authPage("Create a coach", "/register", "Register", "Use an email, a display name, and a password of at least 8 characters.", next));
    }
    if (input.store.coachByEmail(email)) {
      return reply.type("text/html").send(authPage("Create a coach", "/register", "Register", "That email is already registered.", next));
    }
    const coach = input.store.createCoach({
      email,
      displayName,
      passwordHash: await argon2.hash(password),
    });
    setSession(reply, input.store.createSession(coach.id));
    return reply.redirect(next ?? "/agent", 303);
  });

  app.get("/login", async (request, reply) => {
    reply.type("text/html").send(authPage("Log in", "/login", "Log in", "", invitationPath((request.query as { next?: unknown }).next)));
  });
  app.post("/login", async (request, reply) => {
    const body = request.body as Record<string, string>;
    const next = invitationPath(body.next);
    const coach = input.store.coachByEmail(body.email ?? "");
    const password = body.password ?? "";
    if (!coach || !(await argon2.verify(coach.password_hash, password))) {
      return reply.type("text/html").send(authPage("Log in", "/login", "Log in", "Email or password is wrong.", next));
    }
    setSession(reply, input.store.createSession(coach.id));
    return reply.redirect(next ?? "/matches", 303);
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
    reply.header("cache-control", "private, no-store").header("vary", "Cookie").type("text/html").send(page({
      title: "Matches", coachName: coach.display_name, body: matchesBody(input.store.coachMatches(coach.id), labels),
    }));
  });

  app.post("/matches", async (request, reply) => {
    const coach = requireCoach(request, reply);
    if (!coach) return;
    const gameId = (request.body as { gameId?: string }).gameId ?? "";
    if (!isGameId(gameId)) return reply.code(400).send("Unknown game.");
    const match = input.store.createMatch(coach.id, gameId);
    return reply.redirect(`/matches/${match.id}`, 303);
  });

  app.post("/matches/:id/rematch", async (request, reply) => {
    const coach = requireCoach(request, reply);
    if (!coach) return;
    const id = (request.params as { id: string }).id;
    const source = input.store.getMatch(id);
    if (!source) return reply.code(404).send("Match not found.");
    if (!input.store.seats(id).some(seat => seat.coach_id === coach.id)) return reply.code(403).send("Only a participant can create a rematch.");
    if (source.status !== "finished") return reply.code(409).send("Finish this match before creating a rematch.");
    const match = input.store.createMatch(coach.id, source.game_id);
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
    const sendMany = (rows: EventRow[]) => {
      const history = input.store.parsedEvents(id);
      const current = input.store.getMatch(id)!;
      const presented = new Map(timeline(game, current.first_seat, history, viewer).map(event => [event.seq, event]));
      for (const event of rows) {
        if (seen.has(event.seq) || event.seq <= after) continue;
        seen.add(event.seq);
        const position = positionAt(game, current.first_seat, history, viewer, event.seq);
        reply.raw.write(`id: ${event.seq}\ndata: ${JSON.stringify({ event: presented.get(event.seq), view: position.view, firstSeat: position.firstSeat, names: position.names })}\n\n`);
      }
    };
    let live = false;
    const pending: EventRow[] = [];
    const unsubscribe = hub.subscribe(id, (event) => {
      if (live) sendMany([event]);
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
    sendMany(input.store.events(id));
    live = true;
    if (pending.length) sendMany(pending);
  });

  for (const id of input.store.activeMatchIds()) loop(id);

  return app;
}

function viewerFor(store: Store, matchId: string, coach: Coach | undefined): Seat | "spectator" {
  if (!coach) return "spectator";
  const seat = store.seats(matchId).find((row) => row.coach_id === coach.id);
  return seat ? seat.seat : "spectator";
}

function invitationPath(value: unknown): string | undefined {
  return typeof value === "string" && /^\/matches\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value) ? value : undefined;
}

function authPage(title: string, action: string, submit: string, error = "", next?: string): string {
  const email = action === "/login";
  return page({
    title,
    authNext: next,
    body: `<div class="auth-layout"><section class="auth-intro"><div class="arena-diagram" aria-hidden="true">${gameGraphic("tictactoe")}${gameGraphic("four")}${gameGraphic("checkers")}${gameGraphic("fleet")}</div>
      <h1 class="page-title">${escapeHtml(title)}</h1><p class="body">Coach your agent. Watch it compete.</p><p class="auth-note body">Four games. Two agents. Every move recorded.</p></section>
      <section class="auth-form"><h2 class="section-title">${email ? "Welcome back" : "Your place on the sideline"}</h2>
      ${error ? `<p class="error" role="alert">${escapeHtml(error)}</p>` : ""}
      <form class="form" method="post" action="${action}">
        ${next ? `<input type="hidden" name="next" value="${escapeHtml(next)}">` : ""}
        ${field("Email", "email", "", { type: "email" })}
        ${email ? "" : field("Display name", "displayName")}
        ${field("Password", "password", "", { type: "password", describedBy: email ? undefined : "password-help" })}
        ${email ? "" : '<p id="password-help" class="field-help">Use at least 8 characters for your password.</p>'}
        <button class="pill pill-primary" type="submit">${escapeHtml(submit)}</button>
      </form><p class="auth-switch body">${email ? `New here? <a href="/register${next ? `?next=${encodeURIComponent(next)}` : ""}">Create a coach</a>` : `Already registered? <a href="/login${next ? `?next=${encodeURIComponent(next)}` : ""}">Log in</a>`}</p></section></div>`,
  });
}

function matchPage(store: Store, id: string, coach: Coach | undefined, error = "", runner?: RunnerState, modelReady = false): string {
  const match = store.getMatch(id);
  if (!match) return page({ title: "Missing", body: "<p>Match not found.</p>" });
  const seats = store.seats(id);
  const names: Record<string, string> = {};
  for (const seat of seats) names[String(seat.seat)] = store.coachById(seat.coach_id)?.display_name ?? "";
  const viewer = viewerFor(store, id, coach);
  const game = gameById(match.game_id)!;
  const parsed = store.parsedEvents(id);
  const view = viewFor(game, match.first_seat, parsed, viewer);
  const events = timeline(game, match.first_seat, parsed, viewer);
  const mine = coach ? seats.find((seat) => seat.coach_id === coach.id) : undefined;
  const canJoin = coach && match.status === "waiting" && !mine;
  const path = `/matches/${id}`;
  const next = encodeURIComponent(path);
  const waiting = match.status !== "waiting" ? "" : `<div class="waiting-notice"><div>
    <p class="body">${mine ? "Waiting for another coach. Share the match link below; opening it watches, and a signed-in coach must choose Join match." : coach ? "The second seat is open. Join match copies both coaches’ saved instructions and starts the agents." : "You are watching this invitation. Log in or create a coach, then choose Join match to take the open seat."}</p>
    ${!modelReady ? '<p class="body">The model is not configured. Joining is unavailable until it is configured.</p>' : ""}</div>
    ${canJoin ? `<form method="post" action="${path}/join"><button class="pill pill-primary" type="submit"${modelReady ? "" : " disabled"}>Join match</button></form>` : !coach ? `<div class="invitation-auth"><a class="pill pill-primary" href="/login?next=${next}">Log in to join</a><a class="pill pill-ghost" href="/register?next=${next}">Create a coach</a></div>` : ""}</div>`;
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
    authNext: match.status === "waiting" ? path : undefined,
    body: `<div class="match-page first-seat-${match.first_seat ?? 0}"><div class="match-toolbar"><a class="back-link" href="${coach ? "/matches" : `/login?next=${next}`}">← ${coach ? "Matches" : "Log in"}</a><div class="match-meta"><span class="game-badge">${gameGraphic(match.game_id)}${labels[match.game_id]}</span><span class="view-label">${viewer === "spectator" ? "Spectator view" : "Your seat"}</span></div></div>
      <div class="status-row"><h1 class="page-title match-title">${heading}</h1><p class="status-pill" role="status">${dot}<span id="match-status">${match.status === "finished" ? "Finished" : match.status === "waiting" ? "Waiting for opponent" : "In progress"}</span></p></div>
      ${error ? `<p class="error" role="alert">${escapeHtml(error)}</p>` : ""}
      ${waiting}
      <section class="match-invitation" aria-label="Share match"><label class="sr-only" for="match-link">Match link</label><input id="match-link" type="text" readonly value="${escapeHtml(path)}" aria-describedby="copy-link-status"><button id="copy-match-link" class="pill pill-ghost" type="button" hidden>Copy match link</button><p id="copy-link-status" class="body" role="status">You can also copy this page’s address.</p></section>
      <div class="arena-layout"><section class="board-frame" aria-label="Game position"><div class="arena-header"><h2 class="section-title">The board</h2><span class="board-game-name">${labels[match.game_id]}</span></div><div class="participant-rail">${participants}</div>${replayControls(boot.seq)}<div id="board" class="board-stage"></div><div class="arena-footer"><span class="latest-key"><span aria-hidden="true"></span>Latest move</span><span>${match.game_id === "fleet" && viewer === "spectator" ? "Both fleets visible" : "Server-validated moves"}</span></div></section>
        <section class="activity-panel" aria-labelledby="activity-title"><div class="activity-header"><div class="section-heading"><h2 id="activity-title" class="section-title">Agent activity</h2><span id="event-count" class="count-badge">${events.length}</span></div><p id="connection-status" class="connection-status" role="status">${match.status === "finished" ? "Match complete" : "Connecting…"}</p></div><a class="mobile-board-link" href="#replay-controls">View board ↑</a><ol id="events" class="events" tabindex="0" aria-label="Agent action history"></ol></section></div>
      <section id="match-summary" class="panel match-summary" aria-labelledby="summary-heading" hidden><h2 id="summary-heading" class="section-title">Final match summary</h2><div id="summary-content"></div>
        ${mine ? `<div class="post-match-actions"><a class="pill pill-ghost" href="/agent">Edit agent</a><form method="post" action="${path}/rematch"><button class="pill pill-primary" type="submit">Create rematch</button></form><p class="body">A rematch creates a new invitation for ${escapeHtml(labels[match.game_id])}. Share it with your opponent; they choose whether to join.</p></div>` : ""}</section>
      <section class="coaching-section"><div class="section-heading"><h2 class="section-title">Behind the moves</h2><span class="snapshot-tag">${match.status === "waiting" ? "Copied when play begins" : "Instructions at match start"}</span></div><div class="snapshots">${snapshots}</div></section></div>
      <script id="boot" type="application/json">${JSON.stringify(boot).replaceAll("<", "\\u003c")}</script>
      <script>window.__events = ${JSON.stringify(events).replaceAll("<", "\\u003c")};</script>
      <script type="module" src="/client.js"></script>`,
  });
}

export function readModel(env: NodeJS.ProcessEnv): ModelEnv | null {
  return modelEnv(env);
}
