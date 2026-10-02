import { describe, expect, it } from "vitest";
import { tictactoe } from "../../src/rules/tictactoe.ts";
import type { Seat, TicTacToeView, Viewer } from "../../src/rules/types.ts";

type State = ReturnType<typeof tictactoe.start>;

const ALL_CELLS = [
  "r1c1",
  "r1c2",
  "r1c3",
  "r2c1",
  "r2c2",
  "r2c3",
  "r3c1",
  "r3c2",
  "r3c3",
] as const;

function play(state: State, cell: string): State {
  const seat = tictactoe.turn(state);
  expect(tictactoe.validate(state, seat, { cell })).toBe("ok");
  return tictactoe.apply(state, { cell });
}

function playAll(firstSeat: Seat, cells: readonly string[]): State {
  return cells.reduce(play, tictactoe.start(firstSeat));
}

function board(state: State, viewer: Viewer = 0): TicTacToeView {
  return tictactoe.view(state, viewer) as TicTacToeView;
}

describe("tictactoe", () => {
  it("starts with firstSeat as X for seat 0 and seat 1", () => {
    for (const firstSeat of [0, 1] as const) {
      const started = tictactoe.start(firstSeat);
      expect(tictactoe.id).toBe("tictactoe");
      expect(tictactoe.turn(started)).toBe(firstSeat);
      expect(tictactoe.outcome(started)).toBe("ongoing");
      const openings = ALL_CELLS.map((cell) => ({ cell }));
      expect(tictactoe.legalActions(started, firstSeat)).toEqual(openings);
      expect(tictactoe.legalActions(started, firstSeat === 0 ? 1 : 0)).toEqual(openings);

      const after = tictactoe.apply(started, { cell: "r1c1" });
      const view = board(after, firstSeat);
      expect(view).toEqual({
        game: "tictactoe",
        cells: ["X", null, null, null, null, null, null, null, null],
        turn: firstSeat === 0 ? 1 : 0,
        lastCell: "r1c1",
        outcome: "ongoing",
      });
      expect(board(after, 0)).toEqual(board(after, 1));
      expect(board(after, "spectator")).toEqual(view);
    }
  });

  it("wins with three in a row", () => {
    const state = playAll(0, ["r1c1", "r2c1", "r1c2", "r2c2", "r1c3"]);
    const view = board(state);
    expect(view.cells).toEqual(["X", "X", "X", "O", "O", null, null, null, null]);
    expect(view.outcome).toEqual({ winner: 0 });
    expect(view.turn).toBeNull();
    expect(view.lastCell).toBe("r1c3");
    expect(tictactoe.legalActions(state, 1)).toEqual([]);
    expect(tictactoe.validate(state, 1, { cell: "r3c3" })).not.toBe("ok");
    expect(() => tictactoe.apply(state, { cell: "r3c3" })).toThrow();
  });

  it("wins with three in a column", () => {
    const state = playAll(0, ["r1c1", "r1c2", "r2c1", "r2c2", "r3c1"]);
    expect(board(state).cells).toEqual(["X", "O", null, "X", "O", null, "X", null, null]);
    expect(tictactoe.outcome(state)).toEqual({ winner: 0 });
    expect(board(state).turn).toBeNull();
  });

  it("wins on the main diagonal", () => {
    const state = playAll(0, ["r1c1", "r1c2", "r2c2", "r2c1", "r3c3"]);
    expect(board(state).cells[0]).toBe("X");
    expect(board(state).cells[4]).toBe("X");
    expect(board(state).cells[8]).toBe("X");
    expect(tictactoe.outcome(state)).toEqual({ winner: 0 });
    expect(board(state).outcome).toEqual({ winner: 0 });
  });

  it("wins on the anti-diagonal", () => {
    const state = playAll(0, ["r1c3", "r1c2", "r2c2", "r2c3", "r3c1"]);
    expect(board(state).cells[2]).toBe("X");
    expect(board(state).cells[4]).toBe("X");
    expect(board(state).cells[6]).toBe("X");
    expect(tictactoe.outcome(state)).toEqual({ winner: 0 });
  });

  it("treats a line completed on the ninth mark as a win", () => {
    const state = playAll(0, [
      "r1c1",
      "r1c2",
      "r1c3",
      "r2c1",
      "r2c2",
      "r3c1",
      "r2c3",
      "r3c2",
      "r3c3",
    ]);
    const view = board(state);
    expect(view.cells).toEqual(["X", "O", "X", "O", "X", "X", "O", "O", "X"]);
    expect(view.outcome).toEqual({ winner: 0 });
    expect(view.outcome).not.toBe("draw");
    expect(view.turn).toBeNull();
    expect(view.lastCell).toBe("r3c3");
    expect(tictactoe.legalActions(state, 1)).toEqual([]);
  });

  it("draws when the board is full and no line exists", () => {
    const state = playAll(0, [
      "r1c1",
      "r1c2",
      "r1c3",
      "r2c3",
      "r2c2",
      "r3c3",
      "r2c1",
      "r3c1",
      "r3c2",
    ]);
    const view = board(state);
    expect(view.cells).toEqual(["X", "O", "X", "X", "X", "O", "O", "X", "O"]);
    expect(view.outcome).toBe("draw");
    expect(view.turn).toBeNull();
    expect(tictactoe.legalActions(state, 0)).toEqual([]);
    expect(tictactoe.legalActions(state, 0)).not.toBeNull();
  });

  it("rejects an occupied cell", () => {
    const state = play(tictactoe.start(0), "r2c2");
    const verdict = tictactoe.validate(state, 1, { cell: "r2c2" });
    expect(verdict).not.toBe("ok");
    expect(typeof verdict).toBe("string");
    expect(tictactoe.legalActions(state, 1)).not.toContainEqual({ cell: "r2c2" });
    expect(() => tictactoe.apply(state, { cell: "r2c2" })).toThrow();
    expect(board(state).cells[4]).toBe("X");
  });

  it("rejects the wrong seat, a bad shape, and a move after the game ended", () => {
    const started = tictactoe.start(0);
    expect(tictactoe.validate(started, 1, { cell: "r1c1" })).not.toBe("ok");
    expect(tictactoe.validate(started, 0, null)).not.toBe("ok");
    expect(tictactoe.validate(started, 0, {})).not.toBe("ok");
    expect(tictactoe.validate(started, 0, { cell: "r4c4" })).not.toBe("ok");
    expect(tictactoe.validate(started, 0, { cell: "r1c1", extra: true })).not.toBe("ok");
    expect(() => tictactoe.apply(started, { cell: 1 })).toThrow();

    const won = playAll(0, ["r1c1", "r2c1", "r1c2", "r2c2", "r1c3"]);
    expect(tictactoe.validate(won, 1, { cell: "r3c3" })).not.toBe("ok");
    expect(tictactoe.legalActions(won, 1)).toEqual([]);
  });
});
