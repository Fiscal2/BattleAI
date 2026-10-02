import type { FourView, GameModule, Outcome, Seat, Verdict, Viewer } from "./types.js";

const COLUMNS = 7;
const ROWS = 6;

type Side = "A" | "B";
type Cell = Side | null;

export type FourState = {
  grid: Cell[][];
  firstSeat: Seat;
  toMove: Seat;
  last: { column: number; row: number } | null;
  winner: Seat | null;
  draw: boolean;
};

const DIRECTIONS = [
  [1, 0],
  [0, 1],
  [1, 1],
  [1, -1],
] as const;

function otherSeat(seat: Seat): Seat {
  return seat === 0 ? 1 : 0;
}

function sideOf(state: FourState, seat: Seat): Side {
  return seat === state.firstSeat ? "A" : "B";
}

function emptyGrid(): Cell[][] {
  return Array.from({ length: ROWS }, () => Array<Cell>(COLUMNS).fill(null));
}

function cloneGrid(grid: Cell[][]): Cell[][] {
  return grid.map((row) => row.slice());
}

function columnHeight(grid: Cell[][], column: number): number {
  const index = column - 1;
  for (let row = 0; row < ROWS; row++) {
    if (grid[row][index] === null) return row;
  }
  return ROWS;
}

function isFull(grid: Cell[][]): boolean {
  return grid.every((row) => row.every((cell) => cell !== null));
}

function finished(state: FourState): boolean {
  return state.winner !== null || state.draw;
}

function outcomeOf(state: FourState): Outcome {
  if (state.winner !== null) return { winner: state.winner };
  if (state.draw) return "draw";
  return "ongoing";
}

function sideHasLine(grid: Cell[][], side: Side): boolean {
  for (let row = 0; row < ROWS; row++) {
    for (let column = 0; column < COLUMNS; column++) {
      if (grid[row][column] !== side) continue;
      for (const [columnStep, rowStep] of DIRECTIONS) {
        let count = 1;
        for (let step = 1; step < 4; step++) {
          const nextColumn = column + columnStep * step;
          const nextRow = row + rowStep * step;
          if (
            nextRow < 0 ||
            nextRow >= ROWS ||
            nextColumn < 0 ||
            nextColumn >= COLUMNS ||
            grid[nextRow][nextColumn] !== side
          ) {
            break;
          }
          count += 1;
        }
        if (count >= 4) return true;
      }
    }
  }
  return false;
}

function readColumn(action: unknown): { column: number } | { reason: string } {
  if (typeof action !== "object" || action === null || Array.isArray(action)) {
    return { reason: "action must be an object" };
  }
  if (!Object.hasOwn(action, "column")) {
    return { reason: "action must name a column" };
  }
  const record = action as Record<string, unknown>;
  if (Object.keys(record).length !== 1) {
    return { reason: "action must only name a column" };
  }
  const column = record.column;
  if (typeof column !== "number" || !Number.isInteger(column)) {
    return { reason: "column must be a number" };
  }
  if (column < 1 || column > COLUMNS) {
    return { reason: "column must be from 1 to 7" };
  }
  return { column };
}

function openColumns(state: FourState): number[] {
  if (finished(state)) return [];
  const columns: number[] = [];
  for (let column = 1; column <= COLUMNS; column++) {
    if (columnHeight(state.grid, column) < ROWS) columns.push(column);
  }
  return columns;
}

export const four: GameModule<FourState> = {
  id: "four",

  start(firstSeat) {
    return {
      grid: emptyGrid(),
      firstSeat,
      toMove: firstSeat,
      last: null,
      winner: null,
      draw: false,
    };
  },

  turn(state) {
    return state.toMove;
  },

  legalActions(state, _seat) {
    return openColumns(state).map((column) => ({ column }));
  },

  validate(state, seat, action): Verdict {
    if (finished(state)) return "game is over";
    if (seat !== state.toMove) return "not your turn";
    const parsed = readColumn(action);
    if ("reason" in parsed) return parsed.reason;
    if (columnHeight(state.grid, parsed.column) >= ROWS) return "column is full";
    return "ok";
  },

  apply(state, action) {
    const verdict = four.validate(state, state.toMove, action);
    if (verdict !== "ok") throw new Error(verdict);
    const column = (action as { column: number }).column;
    const seat = state.toMove;
    const grid = cloneGrid(state.grid);
    const row = columnHeight(grid, column);
    grid[row][column - 1] = sideOf(state, seat);
    const won = sideHasLine(grid, sideOf(state, seat));
    return {
      grid,
      firstSeat: state.firstSeat,
      toMove: otherSeat(seat),
      last: { column, row },
      winner: won ? seat : null,
      draw: !won && isFull(grid),
    };
  },

  view(state, _viewer: Viewer): FourView {
    return {
      game: "four",
      grid: cloneGrid(state.grid),
      turn: finished(state) ? null : state.toMove,
      last: state.last === null ? null : { column: state.last.column, row: state.last.row },
      outcome: outcomeOf(state),
    };
  },

  outcome(state) {
    return outcomeOf(state);
  },
};
