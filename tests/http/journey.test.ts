import argon2 from "argon2";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../src/http/app.ts";
import { openStore } from "../../src/store/db.ts";
let passwordHash: string;
beforeAll(async () => { passwordHash = await argon2.hash("journey-password"); });
function setup() {
  const store = openStore(":memory:");
  const coaches = ["Ada", "Bea", "Cy"].map((displayName, i) => store.createCoach({ email: `journey-${i}@example.test`, displayName, passwordHash }));
  const cookies = coaches.map(c => `session=${store.createSession(c.id)}`);
  const app = createApp({ store, env: {}, complete: async () => { throw new Error("No model calls allowed"); } });
  const match = store.createMatch(coaches[0].id, "fleet"); store.joinMatch(match.id, coaches[1].id);
  store.finishMatch({ matchId: match.id, result: "forfeit", winnerSeat: 0, forfeitSeat: 1, forfeitCause: "model_error" });
  return { app, store, coaches, cookies, match, close: async () => { await app.close(); store.close(); } };
}
describe("match journey HTTP contracts", () => {
  it("creates a same-game waiting rematch with only its requester and no inherited snapshot", async () => {
    const f = setup();
    try {
      f.store.saveAgent(f.coaches[1].id, { persona: "New approach", playbook: "", context: "" });
      const response = await f.app.inject({ method: "POST", url: `/matches/${f.match.id}/rematch`, headers: { cookie: f.cookies[1] } });
      expect(response.statusCode).toBe(303);
      const id = response.headers.location!.split("/").at(-1)!;
      expect(id).not.toBe(f.match.id);
      expect(f.store.getMatch(id)).toMatchObject({ game_id: "fleet", status: "waiting", first_seat: null });
      expect(f.store.seats(id)).toMatchObject([{ coach_id: f.coaches[1].id, seat: 0, snapshot_json: "{}" }]);
      expect(f.store.events(id).map(e => e.type)).toEqual(["seated"]);
      expect(f.store.joinMatch(id, f.coaches[0].id)).toEqual({ ok: true });
      expect(JSON.parse(f.store.seats(id)[0].snapshot_json).persona).toBe("New approach");
      expect(f.store.getMatch(f.match.id)?.status).toBe("finished");
    } finally { await f.close(); }
  });
  it("rejects rematches from signed-out/other coaches, unfinished or missing matches without creating records", async () => {
    const f = setup();
    try {
      const waiting = f.store.createMatch(f.coaches[0].id, "four");
      const count = () => (f.store.db.prepare("SELECT COUNT(*) AS n FROM matches").get() as { n: number }).n;
      const before = count();
      for (const [id, cookie, status] of [[f.match.id, "", 401], [f.match.id, f.cookies[2], 403], [waiting.id, f.cookies[0], 409], ["missing", f.cookies[0], 404]] as const) {
        expect((await f.app.inject({ method: "POST", url: `/matches/${id}/rematch`, headers: { cookie } })).statusCode).toBe(status);
      }
      expect(count()).toBe(before);
    } finally { await f.close(); }
  });
  it("preserves only a local match invitation through login, registration and their error pages", async () => {
    const f = setup();
    try {
      const waiting = f.store.createMatch(f.coaches[0].id, "four");
      const next = `/matches/${waiting.id}`;
      const signedOut = await f.app.inject(next);
      expect(signedOut.body).toContain(`/login?next=${encodeURIComponent(next)}`);
      expect(signedOut.body).toContain(`class="back-link" href="/login?next=${encodeURIComponent(next)}"`);
      expect(signedOut.body).not.toContain('>Join match</button>');
      for (const route of ["/login", "/register"]) {
        const page = await f.app.inject(`${route}?next=${encodeURIComponent(next)}`);
        expect(page.body).toContain(`name="next" value="${next}"`);
        const error = await f.app.inject({ method: "POST", url: route, payload: { next, email: "bad", password: "" } });
        expect(error.body).toContain(`name="next" value="${next}"`);
      }
      const login = await f.app.inject({ method: "POST", url: "/login", payload: { next, email: "journey-1@example.test", password: "journey-password" } });
      expect(login.headers.location).toBe(next);
      const registered = await f.app.inject({ method: "POST", url: "/register", payload: { next, email: "fresh@example.test", displayName: "Fresh", password: "journey-password" } });
      expect(registered.headers.location).toBe(next);
      expect(f.store.getMatch(waiting.id)?.status).toBe("waiting");
      for (const bad of ["https://evil.example/path", "//evil.example", "/agent", next + "?x=y", [next, next]]) {
        const response = await f.app.inject({ method: "POST", url: "/login", payload: { next: bad, email: "journey-1@example.test", password: "journey-password" } });
        expect(response.headers.location).toBe("/matches");
      }
    } finally { await f.close(); }
  });
  it("offers join guidance by viewer, a selectable link, and participant post-match actions", async () => {
    const f = setup();
    try {
      const waiting = f.store.createMatch(f.coaches[0].id, "four");
      const owner = await f.app.inject({ url: `/matches/${waiting.id}`, headers: { cookie: f.cookies[0] } });
      expect(owner.body).toContain("Copy match link");
      expect(owner.body).toContain('id="match-link"');
      expect(owner.body).toContain("another coach");
      const visitor = await f.app.inject({ url: `/matches/${waiting.id}`, headers: { cookie: f.cookies[1] } });
      expect(visitor.body).toContain("Join match");
      const finished = await f.app.inject({ url: `/matches/${f.match.id}`, headers: { cookie: f.cookies[0] } });
      expect(finished.body).toContain("Final match summary");
      expect(finished.body).toContain("Edit agent");
      expect(finished.body).toContain("Create rematch");
      expect((await f.app.inject(`/matches/${f.match.id}`)).body).not.toContain('>Create rematch</button>');
    } finally { await f.close(); }
  });
});
