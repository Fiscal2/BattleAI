import { describe, expect, it } from "vitest";
import { ensureLoop, playTurn } from "../../src/match/runner.ts";
import { games } from "../../src/rules/index.ts";
import { openStore } from "../../src/store/db.ts";
import type { ChatMessage, Completion } from "../../src/model/client.ts";

const script = (replies: Completion[]) => {
  let index = 0;
  return async (_messages: ChatMessage[]): Promise<Completion> => replies[index++] ?? { error: "empty" };
};

describe("match loop", () => {
  it("plays a scripted tic-tac-toe game to a win", async () => {
    const store = openStore(":memory:");
    const ada = store.createCoach({ email: "ada@example.com", displayName: "Ada", passwordHash: "x" });
    const bea = store.createCoach({ email: "bea@example.com", displayName: "Bea", passwordHash: "x" });
    const match = store.createMatch(ada.id, "tictactoe");
    store.joinMatch(match.id, bea.id);
    const moves = ["r1c1", "r2c1", "r1c2", "r2c2", "r1c3"];
    const running = new Map<string, Promise<void>>();
    ensureLoop({
      store,
      gameFor: (id) => games[id],
      complete: script(moves.map((cell) => ({ content: JSON.stringify({ cell }) }))),
      configured: true,
      running,
      matchId: match.id,
    });
    await running.get(match.id);
    const finished = store.getMatch(match.id)!;
    expect(finished.status).toBe("finished");
    expect(finished.result).toBe("decided");
    store.close();
  });

  it("forfeits on the third invalid reply and resets after a valid one", async () => {
    const store = openStore(":memory:");
    const ada = store.createCoach({ email: "ada@example.com", displayName: "Ada", passwordHash: "x" });
    const bea = store.createCoach({ email: "bea@example.com", displayName: "Bea", passwordHash: "x" });
    const match = store.createMatch(ada.id, "tictactoe");
    store.joinMatch(match.id, bea.id);
    const first = store.getMatch(match.id)!;
    await playTurn({
      store,
      game: games.tictactoe,
      matchId: match.id,
      complete: script([{ content: "nope" }, { content: "nope" }, { content: '{"cell":"r2c2"}' }]),
    });
    expect(store.getMatch(match.id)?.status).toBe("active");
    await playTurn({
      store,
      game: games.tictactoe,
      matchId: match.id,
      complete: script([{ content: "no" }, { content: "no" }, { content: "no" }]),
    });
    const finished = store.getMatch(match.id)!;
    expect(finished.result).toBe("forfeit");
    expect(finished.forfeit_cause).toBe("invalid_action");
    expect(finished.forfeit_seat).not.toBe(first.first_seat);
    expect(finished.winner_seat).toBe(first.first_seat);
    store.close();
  });

  it("does not forfeit when the model is unset at startup", async () => {
    const store = openStore(":memory:");
    const ada = store.createCoach({ email: "ada@example.com", displayName: "Ada", passwordHash: "x" });
    const bea = store.createCoach({ email: "bea@example.com", displayName: "Bea", passwordHash: "x" });
    const match = store.createMatch(ada.id, "tictactoe");
    store.joinMatch(match.id, bea.id);
    const running = new Map<string, Promise<void>>();
    ensureLoop({
      store,
      gameFor: (id) => games[id],
      complete: async () => ({ content: "nope" }),
      configured: false,
      running,
      matchId: match.id,
    });
    expect(running.size).toBe(0);
    expect(store.getMatch(match.id)?.status).toBe("active");
    store.close();
  });
});
