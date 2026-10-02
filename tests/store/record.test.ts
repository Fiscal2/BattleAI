import { describe, expect, it } from "vitest";
import { openStore } from "../../src/store/db.ts";

describe("match record lines", () => {
  it("records a forfeit as a loss for the seat and a win for the opponent", () => {
    const store = openStore(":memory:");
    const ada = store.createCoach({ email: "ada@example.com", displayName: "Ada", passwordHash: "x" });
    const bea = store.createCoach({ email: "bea@example.com", displayName: "Bea", passwordHash: "x" });
    const match = store.createMatch(ada.id, "tictactoe");
    expect(store.joinMatch(match.id, bea.id).ok).toBe(true);
    store.finishMatch({
      matchId: match.id,
      result: "forfeit",
      winnerSeat: 1,
      forfeitSeat: 0,
      forfeitCause: "invalid_action",
    });
    const next = store.createMatch(ada.id, "fleet");
    store.joinMatch(next.id, bea.id);
    const adaSnap = JSON.parse(store.seats(next.id).find((seat) => seat.seat === 0)!.snapshot_json) as {
      results: string[];
    };
    const beaSnap = JSON.parse(store.seats(next.id).find((seat) => seat.seat === 1)!.snapshot_json) as {
      results: string[];
    };
    expect(adaSnap.results[0]).toBe("tictactoe, Bea, loss invalid_action");
    expect(beaSnap.results[0]).toBe("tictactoe, Ada, win");
    store.close();
  });
});
