import { describe, expect, it } from "vitest";
import { createApp } from "../../src/http/app.ts";
import { openStore } from "../../src/store/db.ts";
import type { Seat } from "../../src/rules/types.ts";

const placement = { ships: [
  { length: 5, cells: ["A1", "A2", "A3", "A4", "A5"] },
  { length: 4, cells: ["C1", "C2", "C3", "C4"] },
  { length: 3, cells: ["E1", "E2", "E3"] },
  { length: 3, cells: ["G1", "G2", "G3"] },
  { length: 2, cells: ["I1", "I2"] },
] };
function setup() {
  const store = openStore(":memory:");
  const a = store.createCoach({ email: "a@example.test", displayName: "Ada", passwordHash: "fixture" });
  const b = store.createCoach({ email: "b@example.test", displayName: "Turing", passwordHash: "fixture" });
  const env: NodeJS.ProcessEnv = {};
  let calls = 0;
  const app = createApp({ store, env, complete: async () => { calls++; return { error: "fixture" }; } });
  const cookies = [a, b].map(c => `session=${store.createSession(c.id)}`);
  return { store, app, env, a, b, cookies, calls: () => calls, close: async () => { await app.close(); store.close(); } };
}

describe("historical positions", () => {
  it("replays the opening, individual actions and result without leaking the final result into earlier positions", async () => {
    const f = setup();
    try {
      const m = f.store.createMatch(f.a.id, "tictactoe"); f.store.joinMatch(m.id, f.b.id);
      const first = f.store.getMatch(m.id)!.first_seat as Seat;
      ["r1c1", "r2c1", "r1c2", "r2c2", "r1c3"].forEach((cell, i) => f.store.appendEvent(m.id, "action", { seat: i % 2 ? 1 - first : first, action: { cell } }));
      f.store.finishMatch({ matchId: m.id, result: "decided", winnerSeat: first });
      const position = async(seq: number) => (await f.app.inject(`/matches/${m.id}/position?seq=${seq}`)).json();
      expect(await position(0)).toMatchObject({ seq: 0, view: null, firstSeat: null, names: {}, result: null });
      expect(await position(1)).toMatchObject({ view: null, firstSeat: null, names: { "0": "Ada" }, result: null });
      expect((await position(2)).view).toMatchObject({ cells: Array(9).fill(null), outcome: "ongoing" });
      expect((await position(3)).view).toMatchObject({ cells: ["X", null, null, null, null, null, null, null, null], lastCell: "r1c1" });
      expect((await position(3)).result).toBeNull();
      expect(await position(7)).toMatchObject({ result: null, view: { outcome: { winner: first } } });
      expect(await position(8)).toMatchObject({ result: { result: "decided", winnerSeat: first } });
    } finally { await f.close(); }
  });

  it("keeps Fleet ships hidden at historical positions until that position sinks them, for both seats", async () => {
    const f = setup();
    try {
      const m = f.store.createMatch(f.a.id, "fleet"); f.store.joinMatch(m.id, f.b.id);
      f.store.appendEvent(m.id, "action", { seat: 0, action: placement });
      f.store.appendEvent(m.id, "action", { seat: 1, action: placement });
      const first = f.store.getMatch(m.id)!.first_seat as Seat;
      ["A1", "B9", "A2", "D9", "A3", "F9", "A4", "H9", "A5"].forEach((cell, i) => f.store.appendEvent(m.id, "action", { seat: i % 2 ? 1 - first : first, action: { cell } }));
      for (const seat of [0, 1] as const) {
        const earlier = await f.app.inject({ url: `/matches/${m.id}/position?seq=4`, headers: { cookie: f.cookies[seat] } });
        expect(earlier.statusCode).toBe(200);
        expect(earlier.headers["cache-control"]).toContain("no-store");
        expect(earlier.json().view.ships.every((ship: {seat: number}) => ship.seat === seat)).toBe(true);
        expect(earlier.json().view.shots).toEqual([]);
      }
      const afterSink = await f.app.inject({ url: `/matches/${m.id}/position?seq=13`, headers: { cookie: f.cookies[first] } });
      expect(afterSink.json().view.ships.filter((ship: {seat: number}) => ship.seat !== first)).toMatchObject([{ length: 5, sunk: true }]);
      const spectator = await f.app.inject(`/matches/${m.id}/position?seq=4`);
      expect(spectator.json().view.ships).toHaveLength(10);
      expect(spectator.json().view.ships.every((ship: {sunk: boolean}) => !ship.sunk)).toBe(true);
    } finally { await f.close(); }
  });

  it("validates exact sequence bounds and does not resume a match when reading replay history", async () => {
    const f = setup();
    try {
      const m = f.store.createMatch(f.a.id, "four"); f.store.joinMatch(m.id, f.b.id);
      Object.assign(f.env, { MODEL_BASE_URL: "http://not-contacted", MODEL_API_KEY: "fixture", MODEL_NAME: "fixture" });
      for (const query of ["", "?seq=-1", "?seq=1.5", "?seq=NaN", "?seq=Infinity", "?seq=9007199254740992", "?seq=1&seq=2", "?seq=3"]) {
        expect((await f.app.inject(`/matches/${m.id}/position${query}`)).statusCode).toBe(400);
      }
      expect((await f.app.inject(`/matches/${m.id}/position?seq=2`)).statusCode).toBe(200);
      expect((await f.app.inject("/matches/missing/position?seq=0")).statusCode).toBe(404);
      expect(f.calls()).toBe(0);
      expect(f.store.getMatch(m.id)?.status).toBe("active");
    } finally { await f.close(); }
  });
});
