import { describe, expect, it } from "vitest";
import { winningLine } from "../../src/web/winning-line.ts";
import type { Seat, View } from "../../src/web/types.ts";

function tic(cells: string, winner: Seat = 0): Extract<View, { game: "tictactoe" }> {
  return {
    game: "tictactoe", cells: Array.from(cells, (cell) => cell === "X" || cell === "O" ? cell : null),
    turn: null, lastCell: null, outcome: { winner },
  };
}

// Fixtures list Four rows from the bottom, just like the public view.
function four(rows: string[], winner: Seat = 0): Extract<View, { game: "four" }> {
  return {
    game: "four", grid: Array.from({ length: 6 }, (_, row) => Array.from({ length: 7 }, (_, column) => {
      const cell = rows[row]?.[column];
      return cell === "A" || cell === "B" ? cell : null;
    })), turn: null, last: null, outcome: { winner },
  };
}

describe("winningLine", () => {
  it.each([
    ["XXX......", ["r1c1", "r1c2", "r1c3"]],
    ["...XXX...", ["r2c1", "r2c2", "r2c3"]],
    ["......XXX", ["r3c1", "r3c2", "r3c3"]],
    ["X..X..X..", ["r1c1", "r2c1", "r3c1"]],
    [".X..X..X.", ["r1c2", "r2c2", "r3c2"]],
    ["..X..X..X", ["r1c3", "r2c3", "r3c3"]],
    ["X...X...X", ["r1c1", "r2c2", "r3c3"]],
    ["..X.X.X..", ["r1c3", "r2c2", "r3c1"]],
  ])("finds the complete Tic line in %s", (cells, expected) => {
    expect(winningLine(tic(cells), 0)).toEqual(new Set(expected));
  });

  it("unites all simultaneous Tic lines without highlighting other winner cells", () => {
    expect(winningLine(tic("XXXOXOXOX"), 0))
      .toEqual(new Set(["r1c1", "r1c2", "r1c3", "r2c2", "r3c1", "r3c3"]));
    expect(winningLine(tic("XXX.O.XO."), 0)).toEqual(new Set(["r1c1", "r1c2", "r1c3"]));
  });

  it.each([
    ["horizontal", ["...AAAA"], ["r1c4", "r1c5", "r1c6", "r1c7"]],
    ["vertical", ["..A", "..A", "..A", "..A"], ["r1c3", "r2c3", "r3c3", "r4c3"]],
    ["rising diagonal", ["A", ".A", "..A", "...A"], ["r1c1", "r2c2", "r3c3", "r4c4"]],
    ["falling diagonal", ["...A", "..A", ".A", "A"], ["r1c4", "r2c3", "r3c2", "r4c1"]],
    ["seven-disc row", ["AAAAAAA"], ["r1c1", "r1c2", "r1c3", "r1c4", "r1c5", "r1c6", "r1c7"]],
    ["six-disc column", ["A", "A", "A", "A", "A", "A"], ["r1c1", "r2c1", "r3c1", "r4c1", "r5c1", "r6c1"]],
    ["long rising diagonal", ["A", ".A", "..A", "...A", "....A"], ["r1c1", "r2c2", "r3c3", "r4c4", "r5c5"]],
    ["long falling diagonal", ["....A", "...A", "..A", ".A", "A"], ["r1c5", "r2c4", "r3c3", "r4c2", "r5c1"]],
  ])("finds every cell of a Four %s", (_name, rows, expected) => {
    expect(winningLine(four(rows), 0)).toEqual(new Set(expected));
  });

  it("unites intersecting Four runs, including the full longer run", () => {
    expect(winningLine(four(["AAAAA", "..A", "..A", "..A"]), 0))
      .toEqual(new Set(["r1c1", "r1c2", "r1c3", "r1c4", "r1c5", "r2c3", "r3c3", "r4c3"]));
    expect(winningLine(four(["A.....A", ".A...A", "..A.A", "...A"]), 0))
      .toEqual(new Set(["r1c1", "r2c2", "r3c3", "r4c4", "r3c5", "r2c6", "r1c7"]));
  });

  it.each([
    [0, 0, "X", "A"], [0, 1, "O", "B"], [1, 1, "X", "A"], [1, 0, "O", "B"],
  ] as const)("maps first seat %i and winning seat %i to %s/%s", (firstSeat, winner, ticMark, fourMark) => {
    expect(winningLine(tic(ticMark.repeat(3) + "......", winner), firstSeat))
      .toEqual(new Set(["r1c1", "r1c2", "r1c3"]));
    expect(winningLine(four([fourMark.repeat(4)], winner), firstSeat))
      .toEqual(new Set(["r1c1", "r1c2", "r1c3", "r1c4"]));
  });

  it("excludes complete opponent lines and unrelated or incomplete winner runs", () => {
    expect(winningLine(tic("XXXOOO.X."), 0)).toEqual(new Set(["r1c1", "r1c2", "r1c3"]));
    expect(winningLine(tic("XXXOOO.X.", 1), 0)).toEqual(new Set(["r2c1", "r2c2", "r2c3"]));
    expect(winningLine(four(["AAAABAA", "BBBB", "A.A.A.A", "AAA"], 1), 0))
      .toEqual(new Set(["r2c1", "r2c2", "r2c3", "r2c4"]));
    expect(winningLine(four(["AAAABAA", "BBBB", "A.A.A.A", "AAA"]), 0))
      .toEqual(new Set(["r1c1", "r1c2", "r1c3", "r1c4"]));
  });

  it.each([
    ["gap", ["AAA.AAA"]],
    ["opponent interruption", ["AAABAAA"]],
    ["row wrap", ["....AAA", "A"]],
    ["short vertical", ["A", "A", "A"]],
    ["short diagonal", ["A", ".A", "..A"]],
    ["opponent line only", ["BBBB", "AAA"]],
  ])("does not highlight a Four %s", (_name, rows) => {
    expect(winningLine(four(rows), 0).size).toBe(0);
  });

  it.each(["ongoing", "draw"] as const)("never highlights an %s view even if its cells contain a line", (outcome) => {
    expect(winningLine({ ...tic("XXX......"), outcome }, 0).size).toBe(0);
    expect(winningLine({ ...four(["AAAAAAA"]), outcome }, 0).size).toBe(0);
  });

  it.each([null, undefined])("requires a known first seat (%s)", (firstSeat) => {
    expect(winningLine(tic("XXX......"), firstSeat).size).toBe(0);
    expect(winningLine(four(["AAAAAAA"]), firstSeat).size).toBe(0);
  });

  it("returns no cells for waiting or games without winning lines", () => {
    expect(winningLine(null, 0).size).toBe(0);
    expect(winningLine({ game: "checkers", pieces: {}, turn: null, lastPath: null, outcome: { winner: 0 } }, 0).size).toBe(0);
    expect(winningLine({ game: "fleet", phase: "done", ships: [], shots: [], lastShot: null, turn: null, outcome: { winner: 0 } }, 0).size).toBe(0);
    expect(winningLine(tic("XX......."), 0).size).toBe(0);
  });
});
