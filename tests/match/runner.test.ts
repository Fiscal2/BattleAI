import { afterEach, describe, expect, it } from "vitest";
import { ensureLoop, playTurn, startLoops } from "../../src/match/runner.ts";
import { games } from "../../src/rules/index.ts";
import { openStore } from "../../src/store/db.ts";
import type { ChatMessage, Completion } from "../../src/model/client.ts";

const script = (replies: Completion[]) => {
  let index = 0;
  return async (_messages: ChatMessage[]): Promise<Completion> => replies[index++] ?? { error: "empty" };
};

const stores: ReturnType<typeof openStore>[] = [];
afterEach(() => {
  for (const store of stores.splice(0)) store.close();
});

function loopInput() {
  const store = openStore(":memory:");
  stores.push(store);
  const ada = store.createCoach({ email: "ada@example.com", displayName: "Ada", passwordHash: "x" });
  const bea = store.createCoach({ email: "bea@example.com", displayName: "Bea", passwordHash: "x" });
  const match = store.createMatch(ada.id, "tictactoe");
  store.joinMatch(match.id, bea.id);
  return {
    store, matchId: match.id, gameFor: (id: keyof typeof games) => games[id],
    running: new Map<string, Promise<void>>(), configured: true,
  };
}

describe("match loop", () => {
  it("reports an unexpected exception and resumes from the committed log on a later start", async () => {
    const input = loopInput();
    const failure = new Error("publication failed");
    const observed: unknown[] = [];
    const first = input.store.getMatch(input.matchId)!.first_seat!;
    ensureLoop({
      ...input,
      complete: script([{ content: '{"cell":"r1c1"}' }]),
      afterEvent: () => { throw failure; },
      onError: (error: unknown) => { observed.push(error); },
    });
    await expect(input.running.get(input.matchId)).resolves.toBeUndefined();
    expect(observed).toEqual([failure]);
    expect(input.running.size).toBe(0);
    expect(input.store.getMatch(input.matchId)?.status).toBe("active");
    const committed = input.store.events(input.matchId);

    ensureLoop({
      ...input,
      complete: script(["r2c1", "r1c2", "r2c2", "r1c3"].map((cell) => ({ content: JSON.stringify({ cell }) }))),
    });
    await input.running.get(input.matchId);
    expect(input.store.events(input.matchId).slice(0, committed.length)).toEqual(committed);
    expect(input.store.parsedEvents(input.matchId).filter((event) => event.type === "action").map((event) => event.payload))
      .toEqual(["r1c1", "r2c1", "r1c2", "r2c2", "r1c3"].map((cell, index) => ({
        seat: index % 2 === 0 ? first : 1 - first, action: { cell },
      })));
    expect(input.store.getMatch(input.matchId)).toMatchObject({ status: "finished", result: "decided", winner_seat: first });
  });

  it.each(["returns", "throws", "rejects"])("settles synchronous loop failures safely when the observer %s", async (behavior) => {
    const input = loopInput();
    const failure = new Error("game lookup failed");
    const observed: unknown[] = [];
    let lookups = 0;
    startLoops({
      ...input,
      gameFor: () => { lookups += 1; throw failure; },
      complete: script([]),
      onError: (error: unknown) => {
        observed.push(error);
        if (behavior === "throws") throw new Error("observer failed");
        if (behavior === "rejects") return Promise.reject(new Error("observer rejected"));
      },
    });
    await expect(input.running.get(input.matchId)).resolves.toBeUndefined();
    expect(observed).toEqual([failure]);
    expect(lookups).toBe(1);
    expect(input.running.size).toBe(0);
    expect(input.store.getMatch(input.matchId)).toMatchObject({ status: "active", result: "", forfeit_cause: "" });
  });

  it("stops after a rejected completer and waits for an explicit configured restart", async () => {
    const input = loopInput();
    const failure = new Error("unexpected completion failure");
    const observed: unknown[] = [];
    let calls = 0;
    const options = {
      ...input,
      complete: async (): Promise<Completion> => { calls += 1; throw failure; },
      onError: (error: unknown) => { observed.push(error); },
    };
    ensureLoop(options);
    await input.running.get(input.matchId);
    expect(observed).toEqual([failure]);
    const committed = input.store.events(input.matchId);
    startLoops({ ...options, configured: false });
    ensureLoop({ ...options, configured: false });
    await Promise.resolve();
    expect(calls).toBe(1);
    expect(input.running.size).toBe(0);
    expect(input.store.events(input.matchId)).toEqual(committed);
    expect(input.store.getMatch(input.matchId)).toMatchObject({ status: "active", result: "", forfeit_cause: "" });

    ensureLoop(options);
    await input.running.get(input.matchId);
    expect(calls).toBe(2);
    expect(observed).toEqual([failure, failure]);
    expect(input.running.size).toBe(0);
    expect(input.store.events(input.matchId)).toEqual(committed);
  });

  it("registers before starting and prevents duplicate loops for concurrent and reentrant starts", async () => {
    const input = loopInput();
    let reentered = false;
    const registrations: boolean[] = [];
    const options = {
      ...input,
      complete: script(["r1c1", "r2c1", "r1c2", "r2c2", "r1c3"].map((cell) => ({ content: JSON.stringify({ cell }) }))),
      gameFor: (id: keyof typeof games) => {
        registrations.push(input.running.has(input.matchId));
        if (!reentered) {
          reentered = true;
          ensureLoop(options);
        }
        return games[id];
      },
    };
    ensureLoop(options);
    const task = input.running.get(input.matchId);
    ensureLoop(options);
    expect(input.running.get(input.matchId)).toBe(task);
    await task;
    expect(registrations).toEqual([true, true, true, true, true]);
    expect(input.store.getMatch(input.matchId)).toMatchObject({ status: "finished", result: "decided" });
    expect(input.store.parsedEvents(input.matchId).filter((event) => event.type === "action")).toHaveLength(5);
    expect(input.running.size).toBe(0);
  });

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
