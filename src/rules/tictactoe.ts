import type { GameModule, Outcome, Seat, TicTacToeView } from "./types.js";

const CELLS = [
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

type Cell = (typeof CELLS)[number];
type Mark = "X" | "O";

export type TicTacToeState = {
  cells: Array<Mark | null>;
  xSeat: Seat;
  next: Seat;
  lastCell: string | null;
};

const LINES: ReadonlyArray<readonly [number, number, number]> = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6],
];

function other(seat: Seat): Seat {
  return seat === 0 ? 1 : 0;
}

function isCell(value: unknown): value is Cell {
  return typeof value === "string" && (CELLS as readonly string[]).includes(value);
}

function isCellAction(action: unknown): action is { cell: Cell } {
  if (action === null || typeof action !== "object" || Array.isArray(action)) return false;
  const keys = Object.keys(action);
  if (keys.length !== 1 || keys[0] !== "cell") return false;
  return isCell((action as { cell: unknown }).cell);
}

function cellIndex(cell: Cell): number {
  return CELLS.indexOf(cell);
}

function winningMark(cells: ReadonlyArray<Mark | null>): Mark | null {
  for (const [a, b, c] of LINES) {
    const mark = cells[a];
    if (mark && mark === cells[b] && mark === cells[c]) return mark;
  }
  return null;
}

function positionOutcome(state: TicTacToeState): Outcome {
  const mark = winningMark(state.cells);
  if (mark) return { winner: mark === "X" ? state.xSeat : other(state.xSeat) };
  if (state.cells.every((cell) => cell !== null)) return "draw";
  return "ongoing";
}

export const tictactoe: GameModule<TicTacToeState> = {
  id: "tictactoe",

  start(firstSeat) {
    return {
      cells: Array.from({ length: 9 }, () => null),
      xSeat: firstSeat,
      next: firstSeat,
      lastCell: null,
    };
  },

  turn(state) {
    return state.next;
  },

  legalActions(state, _seat) {
    if (positionOutcome(state) !== "ongoing") return [];
    return state.cells.flatMap((mark, index) => (mark === null ? [{ cell: CELLS[index] }] : []));
  },

  validate(state, seat, action) {
    if (positionOutcome(state) !== "ongoing") return "game over";
    if (seat !== state.next) return "wrong seat";
    if (!isCellAction(action)) return "bad action";
    if (state.cells[cellIndex(action.cell)] !== null) return "occupied";
    return "ok";
  },

  apply(state, action) {
    const verdict = tictactoe.validate(state, state.next, action);
    if (verdict !== "ok" || !isCellAction(action)) throw new Error(verdict);
    const cells = state.cells.slice();
    cells[cellIndex(action.cell)] = state.next === state.xSeat ? "X" : "O";
    return {
      cells,
      xSeat: state.xSeat,
      next: other(state.next),
      lastCell: action.cell,
    };
  },

  view(state, _viewer): TicTacToeView {
    const outcome = positionOutcome(state);
    return {
      game: "tictactoe",
      cells: state.cells.slice(),
      turn: outcome === "ongoing" ? state.next : null,
      lastCell: state.lastCell,
      outcome,
    };
  },

  outcome(state) {
    return positionOutcome(state);
  },
};
