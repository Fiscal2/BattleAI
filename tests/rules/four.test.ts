import { expect, test } from "vitest";
import { four } from "../../src/rules/four.js";
import type { FourView, Seat } from "../../src/rules/types.js";

function play(firstSeat: Seat, columns: number[]) {
  let state = four.start(firstSeat);
  for (const column of columns) {
    const seat = four.turn(state);
    const verdict = four.validate(state, seat, { column });
    expect(verdict, `column ${column}`).toBe("ok");
    state = four.apply(state, { column });
  }
  return state;
}

function seen(state: ReturnType<typeof four.start>): FourView {
  return four.view(state, "spectator") as FourView;
}

test("disc stacks on the lowest empty cell", () => {
  const opening = four.start(1);
  const empty = seen(opening);
  expect(four.id).toBe("four");
  expect(four.turn(opening)).toBe(1);
  expect(empty.game).toBe("four");
  expect(empty.turn).toBe(1);
  expect(empty.last).toBeNull();
  expect(empty.outcome).toBe("ongoing");
  expect(empty.outcome).toEqual(four.outcome(opening));
  expect(empty.grid).toHaveLength(6);
  expect(empty.grid.every((row) => row.length === 7 && row.every((cell) => cell === null))).toBe(true);
  expect(four.legalActions(opening, 1)).toEqual([1, 2, 3, 4, 5, 6, 7].map((column) => ({ column })));

  const state = play(1, [4, 4]);
  const view = seen(state);
  expect(view.grid[0][3]).toBe("A");
  expect(view.grid[1][3]).toBe("B");
  expect(view.grid[2][3]).toBeNull();
  expect(view.last).toEqual({ column: 4, row: 1 });
  expect(view.turn).toBe(1);
  expect(view.outcome).toBe("ongoing");
  expect(view.outcome).toEqual(four.outcome(state));
  expect(four.view(state, 0)).toEqual(four.view(state, 1));
  expect(four.view(state, 1)).toEqual(view);
  expect(seen(opening).grid[0][3]).toBeNull();
});

test("a full column is absent from legal actions", () => {
  const state = play(0, [1, 1, 1, 1, 1, 1]);
  const actions = four.legalActions(state, 0);
  expect(actions).toEqual([2, 3, 4, 5, 6, 7].map((column) => ({ column })));
  expect(actions?.some((action) => JSON.stringify(action) === JSON.stringify({ column: 1 }))).toBe(false);
  expect(four.validate(state, 0, { column: 1 })).not.toBe("ok");
  expect(() => four.apply(state, { column: 1 })).toThrow();
  expect(four.validate(state, 0, { column: 2 })).toBe("ok");
});

test("four in a row wins on the completing move", () => {
  const columns = [1, 7, 2, 7, 3, 7, 4];
  expect(four.outcome(play(0, columns.slice(0, -1)))).toBe("ongoing");
  const state = play(0, columns);
  expect(seen(state).grid[0].slice(0, 4)).toEqual(["A", "A", "A", "A"]);
  expect(four.outcome(state)).toEqual({ winner: 0 });
  expect(seen(state).turn).toBeNull();
  expect(seen(state).outcome).toEqual(four.outcome(state));
  expect(four.legalActions(state, 0)).toEqual([]);
  expect(four.legalActions(state, 1)).toEqual([]);
});

test("four in a column wins on the completing move", () => {
  const columns = [1, 2, 1, 2, 1, 2, 1];
  expect(four.outcome(play(0, columns.slice(0, -1)))).toBe("ongoing");
  const state = play(0, columns);
  expect([0, 1, 2, 3].map((row) => seen(state).grid[row][0])).toEqual(["A", "A", "A", "A"]);
  expect(four.outcome(state)).toEqual({ winner: 0 });
  expect(seen(state).last).toEqual({ column: 1, row: 3 });
});

test("a rising diagonal wins on the completing move", () => {
  const columns = [4, 1, 3, 4, 3, 3, 2, 2, 4, 4];
  expect(four.outcome(play(0, columns.slice(0, -1)))).toBe("ongoing");
  const state = play(0, columns);
  const grid = seen(state).grid;
  expect([grid[0][0], grid[1][1], grid[2][2], grid[3][3]]).toEqual(["B", "B", "B", "B"]);
  expect(seen(state).last).toEqual({ column: 4, row: 3 });
  expect(four.outcome(state)).toEqual({ winner: 1 });
});

test("a falling diagonal wins on the completing move", () => {
  const columns = [1, 4, 2, 1, 3, 3, 2, 2, 1, 1];
  expect(four.outcome(play(0, columns.slice(0, -1)))).toBe("ongoing");
  const state = play(0, columns);
  const grid = seen(state).grid;
  expect([grid[3][0], grid[2][1], grid[1][2], grid[0][3]]).toEqual(["B", "B", "B", "B"]);
  expect(seen(state).last).toEqual({ column: 1, row: 3 });
  expect(four.outcome(state)).toEqual({ winner: 1 });
});

test("five in a row formed by filling the middle cell of the line", () => {
  const columns = [1, 6, 2, 7, 4, 6, 5, 7, 3];
  expect(four.outcome(play(0, columns.slice(0, -1)))).toBe("ongoing");
  const state = play(0, columns);
  const view = seen(state);
  expect(view.grid[0].slice(0, 5)).toEqual(["A", "A", "A", "A", "A"]);
  expect(view.last).toEqual({ column: 3, row: 0 });
  expect(four.outcome(state)).toEqual({ winner: 0 });
  expect(view.turn).toBeNull();
  expect(view.outcome).toEqual({ winner: 0 });
});

const winOnLastDisc = [
  3, 7, 5, 4, 4, 2, 4, 3, 5, 2, 1, 1, 4, 5, 5, 7, 6, 5, 2, 6, 6, 4, 2, 1, 2, 2, 6, 3, 7, 7, 7, 5, 1, 3, 6, 1, 1,
  4, 3, 7, 3, 6,
];

test("a line completed by the 42nd disc is a win", () => {
  expect(winOnLastDisc).toHaveLength(42);
  const almost = play(0, winOnLastDisc.slice(0, 41));
  expect(four.outcome(almost)).toBe("ongoing");
  expect(seen(almost).grid.flat().filter((cell) => cell !== null)).toHaveLength(41);
  const state = play(0, winOnLastDisc);
  expect(seen(state).grid.flat().filter((cell) => cell !== null)).toHaveLength(42);
  expect(four.outcome(state)).toEqual({ winner: 1 });
  expect(seen(state).outcome).toEqual({ winner: 1 });
  expect(seen(state).turn).toBeNull();
  expect(four.legalActions(state, 1)).toEqual([]);
});

const drawn = [
  7, 6, 2, 1, 2, 7, 2, 4, 5, 1, 6, 6, 5, 2, 6, 6, 7, 5, 5, 7, 7, 4, 4, 7, 3, 1, 6, 2, 2, 5, 1, 3, 3, 4, 3, 3, 4, 5,
  3, 1, 4, 1,
];

test("42 discs with no line of four is a draw", () => {
  expect(drawn).toHaveLength(42);
  const state = play(0, drawn);
  const view = seen(state);
  expect(view.grid.flat().filter((cell) => cell !== null)).toHaveLength(42);
  expect(four.outcome(state)).toBe("draw");
  expect(view.outcome).toBe("draw");
  expect(view.turn).toBeNull();
  expect(four.legalActions(state, 0)).toEqual([]);
});

test('{"column":"4"} does not validate', () => {
  const state = four.start(0);
  const verdict = four.validate(state, 0, { column: "4" });
  expect(verdict).not.toBe("ok");
  expect(typeof verdict).toBe("string");
  expect(() => four.apply(state, { column: "4" })).toThrow();
  expect(four.validate(state, 0, { column: 4 })).toBe("ok");
});

test("validate rejects the wrong seat, a bad shape, and a move after the end", () => {
  const opening = four.start(0);
  expect(four.validate(opening, 1, { column: 4 })).not.toBe("ok");
  expect(four.validate(opening, 0, null)).not.toBe("ok");
  expect(four.validate(opening, 0, [])).not.toBe("ok");
  expect(four.validate(opening, 0, {})).not.toBe("ok");
  expect(four.validate(opening, 0, { cell: 4 })).not.toBe("ok");
  expect(four.validate(opening, 0, { column: 4.5 })).not.toBe("ok");
  expect(four.validate(opening, 0, { column: 0 })).not.toBe("ok");
  expect(four.validate(opening, 0, { column: 8 })).not.toBe("ok");
  expect(() => four.apply(opening, { column: 8 })).toThrow();

  const finished = play(0, [1, 7, 2, 7, 3, 7, 4]);
  expect(four.validate(finished, 1, { column: 5 })).not.toBe("ok");
  expect(four.validate(finished, 0, { column: 5 })).not.toBe("ok");
  expect(() => four.apply(finished, { column: 5 })).toThrow();
});
