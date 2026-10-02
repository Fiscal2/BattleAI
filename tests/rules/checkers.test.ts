import { describe, expect, it } from "vitest";
import {
  checkers,
  legalPathsFrom,
  openingPaths,
  positionKey,
  setup,
} from "../../src/rules/checkers.ts";
import type { CheckersPiece, CheckersView, Seat } from "../../src/rules/types.ts";

const RED_OPENING: number[][] = [
  [9, 13],
  [9, 14],
  [10, 14],
  [10, 15],
  [11, 15],
  [11, 16],
  [12, 16],
];

const WHITE_OPENING: number[][] = [
  [21, 17],
  [22, 17],
  [22, 18],
  [23, 18],
  [23, 19],
  [24, 19],
  [24, 20],
];

/** 80 quiet king plies. Red starts on 1, White on 32. No position repeats three times. */
const QUIET_KING_PLIES: number[][] = [
  [1, 6], [32, 27], [6, 9], [27, 32], [9, 14], [32, 27], [14, 17], [27, 24],
  [17, 21], [24, 28], [21, 17], [28, 32], [17, 14], [32, 27], [14, 18], [27, 31],
  [18, 22], [31, 27], [22, 18], [27, 32], [18, 22], [32, 28], [22, 25], [28, 32],
  [25, 29], [32, 27], [29, 25], [27, 31], [25, 21], [31, 26], [21, 25], [26, 31],
  [25, 21], [31, 26], [21, 25], [26, 23], [25, 29], [23, 27], [29, 25], [27, 32],
  [25, 29], [32, 28], [29, 25], [28, 24], [25, 21], [24, 28], [21, 17], [28, 32],
  [17, 21], [32, 27], [21, 17], [27, 31], [17, 13], [31, 27], [13, 9], [27, 23],
  [9, 5], [23, 27], [5, 1], [27, 23], [1, 6], [23, 26], [6, 9], [26, 22],
  [9, 13], [22, 18], [13, 9], [18, 15], [9, 6], [15, 18], [6, 1], [18, 15],
  [1, 6], [15, 18], [6, 1], [18, 15], [1, 5], [15, 18], [5, 9], [18, 22],
];

function openingPieces(): Partial<Record<number, CheckersPiece>> {
  const pieces: Partial<Record<number, CheckersPiece>> = {};
  for (let square = 1; square <= 12; square += 1) pieces[square] = "red-man";
  for (let square = 21; square <= 32; square += 1) pieces[square] = "white-man";
  return pieces;
}

function whiteSeat(firstSeat: Seat): Seat {
  return firstSeat === 0 ? 1 : 0;
}

function pathsOf(actions: unknown[] | null): number[][] {
  expect(actions).not.toBeNull();
  return (actions ?? []).map((action) => (action as { path: number[] }).path);
}

function viewOf(state: ReturnType<typeof checkers.start>, viewer: Seat | "spectator" = 0): CheckersView {
  return checkers.view(state, viewer) as CheckersView;
}

function play(state: ReturnType<typeof checkers.start>, path: number[]) {
  return checkers.apply(state, { path });
}

function playPly(state: ReturnType<typeof checkers.start>, count: number) {
  let next = state;
  for (let index = 0; index < count; index += 1) {
    next = play(next, QUIET_KING_PLIES[index] ?? []);
  }
  return next;
}

describe("checkers", () => {
  it("lists the exact opening paths for both seats, with Red moving first", () => {
    expect(openingPaths("red")).toEqual(RED_OPENING);
    expect(openingPaths("white")).toEqual(WHITE_OPENING);

    for (const firstSeat of [0, 1] as const) {
      const started = checkers.start(firstSeat);
      expect(checkers.turn(started)).toBe(firstSeat);
      expect(checkers.outcome(started)).toBe("ongoing");
      expect(pathsOf(checkers.legalActions(started, firstSeat))).toEqual(RED_OPENING);
      expect(checkers.legalActions(started, whiteSeat(firstSeat))).toEqual([]);
      expect(legalPathsFrom(started)).toEqual(RED_OPENING);

      const whiteToMove = setup({
        firstSeat,
        turn: "white",
        pieces: openingPieces(),
      });
      expect(pathsOf(checkers.legalActions(whiteToMove, whiteSeat(firstSeat)))).toEqual(WHITE_OPENING);
      expect(checkers.legalActions(whiteToMove, firstSeat)).toEqual([]);
      expect(legalPathsFrom(whiteToMove)).toEqual(WHITE_OPENING);

      const redView = viewOf(started, firstSeat);
      const whiteView = viewOf(started, whiteSeat(firstSeat));
      const spectator = viewOf(started, "spectator");
      expect(redView.game).toBe("checkers");
      expect(redView.turn).toBe(firstSeat);
      expect(redView.lastPath).toBeNull();
      expect(redView.outcome).toBe("ongoing");
      expect(redView.pieces).toEqual(whiteView.pieces);
      expect(redView.pieces).toEqual(spectator.pieces);
      expect(redView.pieces["1"]).toBe("red-man");
      expect(redView.pieces["12"]).toBe("red-man");
      expect(redView.pieces["13"]).toBeUndefined();
      expect(redView.pieces["21"]).toBe("white-man");
      expect(redView.pieces["32"]).toBe("white-man");

      expect(checkers.validate(started, firstSeat, { path: [11, 15] })).toBe("ok");
      expect(checkers.validate(started, whiteSeat(firstSeat), { path: [11, 15] })).not.toBe("ok");
      expect(checkers.validate(started, firstSeat, { path: [11, 12] })).not.toBe("ok");
      const moved = play(started, [11, 15]);
      expect(viewOf(started).lastPath).toBeNull();
      expect(viewOf(moved).lastPath).toEqual([11, 15]);
      expect(viewOf(moved).pieces["11"]).toBeUndefined();
      expect(viewOf(moved).pieces["15"]).toBe("red-man");
      expect(checkers.turn(moved)).toBe(whiteSeat(firstSeat));
      expect(() => play(started, [1, 6])).toThrow();
    }
  });

  it("does not let a man move or jump backward", () => {
    const move = setup({
      turn: "red",
      pieces: { 18: "red-man", 32: "white-king" },
    });
    expect(pathsOf(checkers.legalActions(move, 0))).toEqual([
      [18, 22],
      [18, 23],
    ]);

    const jump = setup({
      turn: "red",
      pieces: { 18: "red-man", 14: "white-man", 32: "white-king" },
    });
    expect(pathsOf(checkers.legalActions(jump, 0))).toEqual([
      [18, 22],
      [18, 23],
    ]);
    expect(checkers.validate(jump, 0, { path: [18, 9] })).not.toBe("ok");
  });

  it("lets a king step and jump backward without flying", () => {
    const fly = setup({
      turn: "red",
      pieces: { 9: "red-king", 18: "white-man" },
    });
    expect(pathsOf(checkers.legalActions(fly, 0))).toEqual([
      [9, 5],
      [9, 6],
      [9, 13],
      [9, 14],
    ]);
    expect(checkers.validate(fly, 0, { path: [9, 18] })).not.toBe("ok");

    const jump = setup({
      turn: "red",
      pieces: { 18: "red-king", 14: "white-man", 32: "white-king" },
    });
    expect(pathsOf(checkers.legalActions(jump, 0))).toEqual([[18, 9]]);
    const landed = play(jump, [18, 9]);
    expect(viewOf(landed).pieces).toEqual({
      "9": "red-king",
      "32": "white-king",
    });
  });

  it("requires a capture and allows either jump, including a shorter one", () => {
    const state = setup({
      turn: "red",
      pieces: {
        2: "red-man",
        9: "red-man",
        12: "red-man",
        14: "white-man",
        16: "white-man",
        22: "white-man",
        32: "white-king",
      },
    });
    expect(pathsOf(checkers.legalActions(state, 0))).toEqual([
      [9, 18, 25],
      [12, 19],
    ]);
    expect(checkers.validate(state, 0, { path: [2, 6] })).not.toBe("ok");
    expect(checkers.validate(state, 0, { path: [9, 18] })).not.toBe("ok");
  });

  it("finishes a multiple jump, removes pieces at the end, and will not jump one piece twice", () => {
    const state = setup({
      turn: "red",
      pieces: {
        9: "red-king",
        14: "white-man",
        22: "white-man",
        32: "white-king",
      },
    });
    expect(pathsOf(checkers.legalActions(state, 0))).toEqual([[9, 18, 25]]);
    expect(checkers.validate(state, 0, { path: [9, 18] })).not.toBe("ok");
    expect(checkers.validate(state, 0, { path: [9, 18, 9] })).not.toBe("ok");
    expect(() => play(state, [9, 18, 9])).toThrow();

    const landed = play(state, [9, 18, 25]);
    expect(viewOf(landed).pieces).toEqual({
      "25": "red-king",
      "32": "white-king",
    });
    expect(viewOf(landed).lastPath).toEqual([9, 18, 25]);
    expect(viewOf(landed, 1).pieces).toEqual(viewOf(landed, "spectator").pieces);
    expect(checkers.outcome(landed)).toBe("ongoing");
  });

  it("ends the turn when a man reaches the king-row, even if a king could jump onward", () => {
    const state = setup({
      turn: "red",
      pieces: { 22: "red-man", 26: "white-man", 27: "white-man" },
    });
    expect(pathsOf(checkers.legalActions(state, 0))).toEqual([[22, 31]]);
    expect(checkers.validate(state, 0, { path: [22, 31, 24] })).not.toBe("ok");

    const crowned = play(state, [22, 31]);
    expect(viewOf(crowned).pieces).toEqual({
      "31": "red-king",
      "27": "white-man",
    });
    expect(checkers.turn(crowned)).toBe(1);
    expect(checkers.outcome(crowned)).toBe("ongoing");
  });

  it("loses when a side has no pieces, and when its pieces are blocked", () => {
    for (const firstSeat of [0, 1] as const) {
      const capture = setup({
        firstSeat,
        turn: "red",
        pieces: { 2: "red-king", 7: "white-man" },
      });
      const won = play(capture, [2, 11]);
      expect(checkers.outcome(won)).toEqual({ winner: firstSeat });
      expect(viewOf(won).turn).toBeNull();
      expect(viewOf(won).outcome).toEqual({ winner: firstSeat });
      expect(viewOf(won).pieces).toEqual({ "11": "red-king" });
      expect(viewOf(won, whiteSeat(firstSeat)).pieces).toEqual(viewOf(won, "spectator").pieces);
      expect(checkers.legalActions(won, firstSeat)).toEqual([]);
      expect(checkers.legalActions(won, whiteSeat(firstSeat))).toEqual([]);
      expect(checkers.validate(won, whiteSeat(firstSeat), { path: [11, 8] })).not.toBe("ok");
      expect(() => play(won, [11, 8])).toThrow();
    }

    const blocked = setup({
      turn: "red",
      pieces: { 12: "red-man", 1: "white-man" },
    });
    const stuck = play(blocked, [12, 16]);
    expect(checkers.outcome(stuck)).toEqual({ winner: 0 });
    expect(viewOf(stuck).turn).toBeNull();
    expect(viewOf(stuck).pieces).toEqual({
      "16": "red-man",
      "1": "white-man",
    });
    expect(checkers.legalActions(stuck, 1)).toEqual([]);
    expect(pathsOf(checkers.legalActions(blocked, 0))).toEqual([[12, 16]]);
  });

  it("counts the starting position, ignores the other side to move, and draws on the third occurrence", () => {
    const pieces = { 1: "red-king" as const, 32: "white-king" as const };
    const start = setup({ turn: "red", pieces });

    const once = shuttle(start, 1);
    expect(checkers.outcome(once)).toBe("ongoing");
    expect(viewOf(once).turn).toBe(0);

    const twice = shuttle(start, 2);
    expect(checkers.outcome(twice)).toBe("draw");
    expect(viewOf(twice).turn).toBeNull();
    expect(viewOf(twice).outcome).toBe("draw");
    expect(checkers.legalActions(twice, 0)).toEqual([]);
    expect(checkers.legalActions(twice, 1)).toEqual([]);

    const whiteTurn = setup({ turn: "white", pieces });
    const seeded = setup({
      turn: "red",
      pieces,
      seen: { [positionKey(whiteTurn)]: 2 },
    });
    expect(positionKey(seeded)).not.toBe(positionKey(whiteTurn));
    expect(checkers.outcome(seeded)).toBe("ongoing");
    expect(checkers.outcome(shuttle(seeded, 1))).toBe("ongoing");
  });

  it("draws on the 40th quiet king move by each side, and not on the 39th", () => {
    const start = setup({
      turn: "red",
      pieces: { 1: "red-king", 32: "white-king" },
    });
    const after39 = playPly(start, 78);
    expect(checkers.outcome(after39)).toBe("ongoing");
    expect(checkers.legalActions(after39, 0)?.length).toBeGreaterThan(0);

    const red40 = playPly(start, 79);
    expect(checkers.outcome(red40)).toBe("ongoing");

    const both40 = playPly(start, 80);
    expect(checkers.outcome(both40)).toBe("draw");
    expect(viewOf(both40).turn).toBeNull();
    expect(checkers.legalActions(both40, 0)).toEqual([]);
    expect(checkers.legalActions(both40, 1)).toEqual([]);
  });

  it("resets the quiet-king count when a piece is captured or a man moves", () => {
    const primed = setup({
      turn: "red",
      pieces: { 1: "red-king", 32: "white-king" },
      quiet: { red: 39, white: 39 },
    });
    const redQuiet = play(primed, [1, 5]);
    expect(checkers.outcome(redQuiet)).toBe("ongoing");
    const bothQuiet = play(redQuiet, [32, 28]);
    expect(checkers.outcome(bothQuiet)).toBe("draw");

    let captured = setup({
      turn: "red",
      pieces: { 2: "red-king", 7: "white-man", 32: "white-king" },
      quiet: { red: 39, white: 39 },
    });
    captured = play(captured, [2, 11]);
    expect(checkers.outcome(captured)).toBe("ongoing");
    expect(viewOf(captured).pieces["7"]).toBeUndefined();
    captured = play(captured, [32, 28]);
    captured = play(captured, [11, 8]);
    expect(checkers.outcome(captured)).toBe("ongoing");

    let manMoved = setup({
      turn: "red",
      pieces: { 9: "red-king", 11: "red-man", 32: "white-king" },
      quiet: { red: 39, white: 39 },
    });
    manMoved = play(manMoved, [11, 16]);
    expect(viewOf(manMoved).pieces["16"]).toBe("red-man");
    expect(checkers.outcome(manMoved)).toBe("ongoing");
    manMoved = play(manMoved, [32, 28]);
    expect(checkers.outcome(manMoved)).toBe("ongoing");
    manMoved = play(manMoved, [9, 5]);
    expect(checkers.outcome(manMoved)).toBe("ongoing");
  });

  it("awards a win when capturing the last piece also meets a draw", () => {
    const repeated = setup({
      turn: "white",
      pieces: { 5: "red-king", 32: "white-king" },
    });
    const beforeRepeat = setup({
      turn: "red",
      pieces: { 1: "red-king", 32: "white-king" },
      seen: { [positionKey(repeated)]: 2 },
    });
    expect(checkers.outcome(play(beforeRepeat, [1, 5]))).toBe("draw");

    for (const firstSeat of [0, 1] as const) {
      const afterCapture = setup({
        firstSeat,
        turn: "white",
        pieces: { 11: "red-king" },
      });
      const beforeCapture = setup({
        firstSeat,
        turn: "red",
        pieces: { 2: "red-king", 7: "white-man" },
        quiet: { red: 39, white: 40 },
        seen: { [positionKey(afterCapture)]: 2 },
      });
      expect(checkers.outcome(beforeCapture)).toBe("ongoing");
      const won = play(beforeCapture, [2, 11]);
      expect(checkers.outcome(won)).toEqual({ winner: firstSeat });
      expect(viewOf(won).outcome).toEqual({ winner: firstSeat });
      expect(viewOf(won).pieces).toEqual({ "11": "red-king" });
    }
  });
});

function shuttle(state: ReturnType<typeof checkers.start>, cycles: number) {
  let next = state;
  for (let cycle = 0; cycle < cycles; cycle += 1) {
    next = play(next, [1, 5]);
    next = play(next, [32, 28]);
    next = play(next, [5, 1]);
    next = play(next, [28, 32]);
  }
  return next;
}
