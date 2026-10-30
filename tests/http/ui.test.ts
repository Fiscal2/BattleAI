import { describe, expect, it } from "vitest";
import { createApp } from "../../src/http/app.ts";
import { openStore } from "../../src/store/db.ts";

function bootOf(html: string) {
  const data = html.match(/<script id="boot" type="application\/json">(.*?)<\/script>/s)?.[1];
  return JSON.parse(data!);
}

describe("match presentation", () => {
  it("bootstraps persisted forfeits and escapes coach content without hiding public navigation", async () => {
    const store = openStore(":memory:");
    const app = createApp({ store, env: {}, complete: async () => ({ error: "unset" }) });
    const ada = store.createCoach({ email: "a@test.local", displayName: "Ada <script>alert(1)</script>", passwordHash: "x" });
    const bob = store.createCoach({ email: "b@test.local", displayName: "Bob", passwordHash: "x" });
    store.saveAgent(ada.id, { persona: "</script><b>Persona</b>", playbook: "Plan", context: "Notes" });
    const match = store.createMatch(ada.id, "tictactoe");
    store.joinMatch(match.id, bob.id);
    store.finishMatch({ matchId: match.id, result: "forfeit", winnerSeat: 1, forfeitSeat: 0, forfeitCause: "model_error" });
    const response = await app.inject(`/matches/${match.id}`);
    expect(response.statusCode).toBe(200);
    const boot = bootOf(response.body);
    expect(boot.status).toBe("finished");
    expect(boot.result).toMatchObject({ result: "forfeit", winnerSeat: 1, forfeitCause: "model_error" });
    expect(response.body).toContain('id="events"');
    expect(response.body).toContain("Agent activity");
    expect(response.body).toContain('href="#main"');
    expect(response.body).not.toContain("Ada <script>");
    expect(response.body).toContain("&lt;b&gt;Persona&lt;/b&gt;");
    await app.close(); store.close();
  });

  it("keeps Fleet placements and graphics hidden from the seated opponent", async () => {
    const store = openStore(":memory:");
    const app = createApp({ store, env: {}, complete: async () => ({ error: "unset" }) });
    const a = store.createCoach({ email: "a@test.local", displayName: "Ada", passwordHash: "x" });
    const b = store.createCoach({ email: "b@test.local", displayName: "Bob", passwordHash: "x" });
    const match = store.createMatch(a.id, "fleet");
    store.joinMatch(match.id, b.id);
    store.appendEvent(match.id, "action", { seat: 0, action: { ships: [
      { length: 5, cells: ["A1", "A2", "A3", "A4", "A5"] },
      { length: 4, cells: ["C1", "C2", "C3", "C4"] },
      { length: 3, cells: ["E1", "E2", "E3"] },
      { length: 3, cells: ["G1", "G2", "G3"] },
      { length: 2, cells: ["I1", "I2"] },
    ] } });
    const session = store.createSession(b.id);
    const seated = await app.inject({ url: `/matches/${match.id}`, headers: { cookie: `session=${session}` } });
    const spectator = await app.inject(`/matches/${match.id}`);
    expect(bootOf(seated.body).view.ships).toEqual([]);
    expect(bootOf(seated.body).result).toBeNull();
    expect(seated.body).toContain('"placed":true');
    expect(seated.body).not.toContain('"A1"');
    expect(bootOf(spectator.body).view.ships).toHaveLength(5);
    expect(spectator.body).toContain('"A1"');
    await app.close(); store.close();
  });
});
