import { createApp, createHub } from "../../src/http/app.js";
import { openStore } from "../../src/store/db.js";
import { fold, gameById } from "../../src/rules/index.js";
import type { GameId, Seat } from "../../src/rules/types.js";
import argon2 from "argon2";

// Disposable browser fixtures only: no saved database, provider or account is used.
const store = openStore(":memory:");
const hub = createHub();
const fixtureHash = await argon2.hash("browser-fixture-password");
const coaches = ["Ada", "Turing"].map((displayName, index) => store.createCoach({
  email: `coach-${index}@example.test`, displayName, passwordHash: fixtureHash,
}));
for (const coach of coaches) store.saveAgent(coach.id, { persona: "Patient", playbook: "Check threats", context: "browser-fixture" });
const placement = { ships: [
  { length: 5, cells: ["A1", "A2", "A3", "A4", "A5"] },
  { length: 4, cells: ["C1", "C2", "C3", "C4"] },
  { length: 3, cells: ["E1", "E2", "E3"] },
  { length: 3, cells: ["G1", "G2", "G3"] },
  { length: 2, cells: ["I1", "I2"] },
] };
const ids: Record<string, string> = {};
function create(key: string, gameId: GameId, actions: unknown[] = [], joined = true) {
  const match = store.createMatch(coaches[0].id, gameId);
  ids[key] = match.id;
  if (!joined) return;
  store.joinMatch(match.id, coaches[1].id);
  const game = gameById(gameId)!;
  let state = game.start(store.getMatch(match.id)!.first_seat as Seat);
  for (const candidate of actions) {
    const action = candidate ?? game.legalActions(state, game.turn(state))![0];
    store.appendEvent(match.id, "action", { seat: game.turn(state), action });
    state = game.apply(state, action);
  }
  const result = game.outcome(state);
  if (result !== "ongoing") store.finishMatch({ matchId: match.id, result: result === "draw" ? "draw" : "decided", winnerSeat: result === "draw" ? null : result.winner });
}
create("tic", "tictactoe", ["r1c1", "r2c1", "r1c2", "r2c2", "r1c3"].map(cell => ({ cell })));
create("four", "four", [4, 3, 4, 3].map(column => ({ column })));
create("checkers", "checkers", Array(8).fill(null));
create("fleet", "fleet", [placement, placement, ...["A1", "B9", "A2", "D9", "A3", "F9", "A4", "H9", "A5"].map(cell => ({ cell }))]);
create("live", "tictactoe");
create("waiting", "fleet", [], false);
create("forfeit", "tictactoe");
store.finishMatch({ matchId: ids.forfeit, result: "forfeit", winnerSeat: 1, forfeitSeat: 0, forfeitCause: "model_error" });

// Ranking fixtures distinguish draw/forfeit counts and ties across the 50-row boundary.
const bench = store.createCoach({ email: "bench@example.test", displayName: "League Bench", passwordHash: "fixture" });
for (let i = 1; i <= 54; i++) {
  const coach = store.createCoach({ email: `league-${i}@example.test`, displayName: `League ${String(i).padStart(2, "0")}`, passwordHash: "fixture" });
  const match = store.createMatch(coach.id, "fleet"); store.joinMatch(match.id, bench.id);
  store.finishMatch(i <= 2
    ? { matchId: match.id, result: "forfeit", winnerSeat: 0, forfeitSeat: 1, forfeitCause: i === 1 ? "model_error" : "invalid_action" }
    : { matchId: match.id, result: "decided", winnerSeat: 0 });
}
const draw = store.createMatch(coaches[0].id, "four"); store.joinMatch(draw.id, coaches[1].id);
store.finishMatch({ matchId: draw.id, result: "draw", winnerSeat: null });

const recoveryCoaches = ["Recovery A", "Recovery B"].map((displayName, index) => store.createCoach({ email: `recovery-${index}@example.test`, displayName, passwordHash: "fixture" }));
for (const coach of recoveryCoaches) store.saveAgent(coach.id, { persona: "", playbook: "", context: "recovery-fixture" });
const recovery = store.createMatch(recoveryCoaches[0].id, "tictactoe");
store.joinMatch(recovery.id, recoveryCoaches[1].id);
ids.recovery = recovery.id;
let recoveryCalls = 0;
let fail!: () => void, release!: () => void;
const failureGate = new Promise<void>(resolve => { fail = resolve; });
const recoveryGate = new Promise<void>(resolve => { release = resolve; });
const app = createApp({ store, hub, env: { MODEL_BASE_URL: "http://not-contacted", MODEL_API_KEY: "fixture", MODEL_NAME: "scripted-fixture" }, complete: async messages => {
  const prompt = messages.find(message => message.role === "user")!.content;
  if (prompt.includes("recovery-fixture")) {
    recoveryCalls++;
    if (recoveryCalls === 1) { await failureGate; throw new Error("private provider error: never expose"); }
    if (recoveryCalls === 2) { await recoveryGate; return { content: JSON.stringify(JSON.parse(/^legal: (.*)$/m.exec(prompt)![1])[0]) }; }
  }
  return new Promise<never>(() => {});
} });
app.get("/__test/fixtures", async () => ({ ids, sessions: coaches.map(coach => store.createSession(coach.id)), firstSeats: Object.fromEntries(Object.entries(ids).map(([key,id]) => [key, store.getMatch(id)!.first_seat])), recoveryCalls }));
function step(id: string) {
  const match = store.getMatch(id)!;
  const game = gameById(match.game_id)!;
  const state = fold(game, match.first_seat as Seat, store.parsedEvents(match.id));
  if (game.outcome(state) !== "ongoing") return { finished: true };
  const action = game.legalActions(state, game.turn(state))![0];
  const event = store.appendEvent(match.id, "action", { seat: game.turn(state), action });
  hub.publish(match.id, event);
  const outcome = game.outcome(game.apply(state, action));
  if (outcome !== "ongoing") hub.publish(match.id, store.finishMatch({ matchId: match.id, result: outcome === "draw" ? "draw" : "decided", winnerSeat: outcome === "draw" ? null : outcome.winner }));
  return { seq: event.seq };
}
app.post("/__test/live/step", async () => step(ids.live));
app.post("/__test/journey/step", async () => step(ids.journeyLive));
app.post("/__test/journey/seed", async () => {
  if (!ids.journeyCapture) {
    const paths = [[11,16],[22,17],[7,11],[26,22],[2,7],[23,19],[16,23],[27,18],[11,15],[18,11,2],[12,16],[31,26],[10,15],[17,13],[8,11],[22,18],[15,22,31],[2,7]];
    create("journeyCapture", "checkers", paths.map(path => ({ path })));
    store.finishMatch({ matchId: ids.journeyCapture, result: "forfeit", winnerSeat: 1, forfeitSeat: 0, forfeitCause: "invalid_action" });
    create("journeyFour", "four", [4,3,4,3,4,3,4].map(column => ({ column })));
    const targets = ["J10", ...[2,3,0,1,4].flatMap(index => placement.ships[index].cells)];
    const misses = [...Array(10)].map((_, i) => `B${i+1}`).concat([...Array(10)].map((_, i) => `D${i+1}`));
    const actions: unknown[] = [placement, placement];
    targets.forEach((cell, i) => { actions.push({ cell }); if (i < targets.length - 1) actions.push({ cell: misses[i] }); });
    create("journeyFleet", "fleet", actions);
    create("journeyLive", "tictactoe");
    create("journeyInvitation", "tictactoe", [], false);
  }
  return { ids, sessions: coaches.map(coach => store.createSession(coach.id)) };
});
app.post("/__test/journey/reset", async () => {
  for (const [key, id] of Object.entries(ids)) {
    if (!key.startsWith("journey")) continue;
    store.db.prepare("DELETE FROM events WHERE match_id = ?").run(id);
    store.db.prepare("DELETE FROM seats WHERE match_id = ?").run(id);
    store.db.prepare("DELETE FROM matches WHERE id = ?").run(id);
    delete ids[key];
  }
  for (const coach of coaches) store.saveAgent(coach.id, { persona: "Patient", playbook: "Check threats", context: "browser-fixture" });
  return { ok: true };
});
app.post("/__test/recovery/fail", async () => { fail(); return { ok: true }; });
app.post("/__test/recovery/release", async () => { release(); return { ok: true }; });
await app.listen({ port: Number(process.env.E2E_PORT || 3108), host: "127.0.0.1" });
