import { createReadStream } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import argon2 from "argon2";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import { ensureLoop, presentEvent, startLoops, viewFor, type Completer } from "../match/runner.js";
import { modelEnv, type ModelEnv } from "../model/client.js";
import { gameById, isGameId } from "../rules/index.js";
import type { GameId, Seat } from "../rules/types.js";
import type { Coach, EventRow, Store } from "../store/db.js";
import { escapeHtml, field, page } from "./page.js";

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
  const app = Fastify();
  const hub = input.hub ?? createHub();
  const running = new Map<string, Promise<void>>();
  const configured = () => modelEnv(input.env) !== null;
  const loop = (matchId: string) =>
    ensureLoop({
      store: input.store,
      gameFor: (id) => gameById(id)!,
      complete: input.complete,
      configured: configured(),
      running,
      matchId,
      afterEvent: (event) => hub.publish(matchId, event),
    });

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
        body: `<p class="eyebrow">Coaching</p><h1 class="page-title">Agent</h1>
          <form class="panel form" method="post" action="/agent">
            ${field("Persona", "persona", agent.persona, { multiline: true })}
            ${field("Playbook", "playbook", agent.playbook, { multiline: true })}
            ${field("Context", "context", agent.context, { multiline: true })}
            <button class="pill pill-primary" type="submit">Save agent</button>
          </form>`,
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
    return reply.redirect("/agent", 303);
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
        body: `<p class="eyebrow">Record</p><h1 class="page-title">Matches</h1>
          <form class="panel form" method="post" action="/matches">
            <label class="field"><span class="label-caps">Game</span>
              <select name="gameId">
                <option value="tictactoe">Tic-tac-toe</option>
                <option value="four">Four in a Row</option>
                <option value="checkers">Checkers</option>
                <option value="fleet">Fleet</option>
              </select>
            </label>
            <button class="pill pill-primary" type="submit">Create match</button>
          </form>
          <div class="records">${list || `<p class="body">No finished matches yet.</p>`}</div>`,
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
      return reply.code(409).type("text/html").send(matchPage(input.store, id, coach, "The model is not configured."));
    }
    const joined = input.store.joinMatch(id, coach.id);
    if (!joined.ok) return reply.code(409).type("text/html").send(matchPage(input.store, id, coach, joined.error));
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
    reply.type("text/html").send(matchPage(input.store, id, coachOf(request)));
  });

  app.get("/matches/:id/events", async (request, reply) => {
    const id = (request.params as { id: string }).id;
    const match = input.store.getMatch(id);
    if (!match) return reply.code(404).send("Match not found.");
    const after = Number((request.query as { after?: string }).after ?? 0);
    const viewer = viewerFor(input.store, id, coachOf(request));
    const game = gameById(match.game_id)!;
    reply.hijack();
    reply.raw.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });
    const seen = new Set<number>();
    const send = (event: EventRow) => {
      if (seen.has(event.seq) || event.seq <= after) return;
      seen.add(event.seq);
      const payload = JSON.parse(event.payload_json) as Record<string, unknown>;
      const prefix = input.store.parsedEvents(id).filter((row) => row.seq <= event.seq);
      const current = input.store.getMatch(id)!;
      const view = viewFor(game, current.first_seat, prefix, viewer);
      const body = presentEvent({ seq: event.seq, type: event.type, payload }, match.game_id, viewer);
      reply.raw.write(`id: ${event.seq}\ndata: ${JSON.stringify({ event: body, view })}\n\n`);
    };
    let live = false;
    const pending: EventRow[] = [];
    const unsubscribe = hub.subscribe(id, (event) => {
      if (live) send(event);
      else pending.push(event);
    });
    for (const event of input.store.events(id)) send(event);
    live = true;
    for (const event of pending) send(event);
    request.raw.on("close", unsubscribe);
  });

  startLoops({
    store: input.store,
    gameFor: (id) => gameById(id)!,
    complete: input.complete,
    configured: configured(),
    running,
    afterEvent: (event) => {
      const matchId = event.match_id;
      hub.publish(matchId, event);
    },
  });

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
    body: `<p class="eyebrow">Coach</p><h1 class="page-title">${escapeHtml(title)}</h1>
      ${error ? `<p class="error">${escapeHtml(error)}</p>` : ""}
      <form class="panel form" method="post" action="${action}">
        ${field("Email", "email", "", { type: "email" })}
        ${email ? "" : field("Display name", "displayName")}
        ${field("Password", "password", "", { type: "password" })}
        <button class="pill pill-primary" type="submit">${escapeHtml(submit)}</button>
      </form>`,
  });
}

function matchPage(store: Store, id: string, coach: Coach | undefined, error = ""): string {
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
      return `<article class="panel snapshot"><h2 class="card-title">${escapeHtml(names[String(seat.seat)] || "Seat")}</h2>
        <p class="label-caps">Persona</p><p>${escapeHtml(snap.persona || "—")}</p>
        <p class="label-caps">Playbook</p><p>${escapeHtml(snap.playbook || "—")}</p>
        <p class="label-caps">Context</p><p>${escapeHtml(snap.context || "—")}</p></article>`;
    })
    .join("");
  const boot = {
    matchId: id,
    seq: parsed.at(-1)?.seq ?? 0,
    view,
    names,
    game: match.game_id,
  };
  const dot = match.status === "finished" ? "" : `<span class="dot ${match.status}"></span>`;
  return page({
    title: labels[match.game_id],
    coachName: coach?.display_name,
    body: `<p class="eyebrow">${escapeHtml(labels[match.game_id])}</p>
      <div class="status-row"><h1 class="page-title">${escapeHtml(names["0"] || "Open seat")} vs ${escapeHtml(names["1"] || "Open seat")}</h1>
      <p class="status-pill">${dot}${escapeHtml(match.status)}</p></div>
      ${error ? `<p class="error">${escapeHtml(error)}</p>` : ""}
      ${canJoin ? `<form method="post" action="/matches/${id}/join"><button class="pill pill-primary" type="submit">Join</button></form>` : ""}
      <div class="board-frame"><div id="board"></div></div>
      <div class="split">
        <section><h2 class="section-title">Events</h2><ol id="events" class="events"></ol></section>
        <section class="snapshots">${snapshots}</section>
      </div>
      <script id="boot" type="application/json">${JSON.stringify(boot).replaceAll("<", "\\u003c")}</script>
      <script>window.__events = ${JSON.stringify(events).replaceAll("<", "\\u003c")};</script>
      <script type="module" src="/client.js"></script>`,
  });
}

export function readModel(env: NodeJS.ProcessEnv): ModelEnv | null {
  return modelEnv(env);
}
