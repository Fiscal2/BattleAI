import { describe, expect, it } from "vitest";
import { createApp } from "../../src/http/app.ts";
import { openStore } from "../../src/store/db.ts";

function setup() {
  const store = openStore(":memory:");
  const a = store.createCoach({ email: "private-a@example.test", displayName: '<Coach & A>', passwordHash: "private-hash-a" });
  const b = store.createCoach({ email: "private-b@example.test", displayName: "Coach B", passwordHash: "private-hash-b" });
  store.saveAgent(a.id, { persona: "private-coaching", playbook: "", context: "" });
  const app = createApp({ store, env: {}, complete: async () => { throw new Error("Rankings must not run models"); } });
  const cookie = `session=${store.createSession(a.id)}`;
  const match = store.createMatch(a.id, "fleet"); store.joinMatch(match.id, b.id);
  store.finishMatch({ matchId: match.id, result: "forfeit", winnerSeat: 1, forfeitSeat: 0, forfeitCause: "model_error" });
  return { store, app, a, cookie, close: async () => { await app.close(); store.close(); } };
}

describe("Rankings HTTP boundary", () => {
  it("serves public aggregates, escapes names, explains forfeits and excludes private account/coaching data", async () => {
    const f = setup();
    try {
      const response = await f.app.inject("/rankings");
      expect(response.statusCode).toBe(200);
      expect(response.headers["cache-control"]).toBe("private, no-store");
      expect(response.body).toContain("&lt;Coach &amp; A&gt;");
      expect(response.body).toContain("Coach B");
      expect(response.body).toContain("Forfeit W/L");
      expect(response.body).toContain('aria-current="page">Rankings');
      for (const secret of ["private-a@example.test", "private-hash-a", "private-coaching"]) expect(response.body).not.toContain(secret);
      const mine = await f.app.inject({ url: "/rankings", headers: { cookie: f.cookie } });
      expect(mine.body).toContain('class="ranking-you">You</span>');
      expect(response.body).not.toContain('class="ranking-you">You</span>');
    } finally { await f.close(); }
  });

  it("filters games, handles empty records, and rejects malformed or nonexistent pages", async () => {
    const f = setup();
    try {
      expect((await f.app.inject("/rankings?game=fleet")).body).toContain("Coach B");
      const empty = await f.app.inject("/rankings?game=four");
      expect(empty.statusCode).toBe(200);
      expect(empty.body).toContain("No finished matches yet");
      expect(empty.body).not.toContain("Coach B");
      for (const query of ["game=unknown", "game=fleet&game=four", "page=0", "page=-1", "page=1.5", "page=1&page=2", "page=9007199254740992", "page=1e2"]) {
        expect((await f.app.inject(`/rankings?${query}`)).statusCode).toBe(400);
      }
      expect((await f.app.inject("/rankings?page=2")).statusCode).toBe(404);
    } finally { await f.close(); }
  });

  it("saves coaching only for the signed-in coach, confirms it, and preserves an existing snapshot", async () => {
    const f = setup();
    try {
      const before = f.store.seats(f.store.record(f.a.id)[0].match.id)[0].snapshot_json;
      const saved = await f.app.inject({ method: "POST", url: "/agent", headers: { cookie: f.cookie, "content-type": "application/x-www-form-urlencoded" }, payload: "persona=Precise&playbook=Check+threats&context=Review+replay" });
      expect(saved.statusCode).toBe(303);
      expect(saved.headers.location).toBe("/agent?saved=1");
      const page = await f.app.inject({ url: saved.headers.location, headers: { cookie: f.cookie } });
      expect(page.body).toContain("Agent saved");
      expect(f.store.getAgent(f.a.id)).toMatchObject({ persona: "Precise", playbook: "Check threats", context: "Review replay" });
      expect(f.store.seats(f.store.record(f.a.id)[0].match.id)[0].snapshot_json).toBe(before);
      const signedOut = await f.app.inject("/agent");
      expect(signedOut.statusCode).toBe(302);
      expect(signedOut.headers.location).toBe("/login");
    } finally { await f.close(); }
  });
});
