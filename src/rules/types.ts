export type Seat = 0 | 1;
export type Viewer = Seat | "spectator";
export type Outcome = "ongoing" | { winner: Seat } | "draw";
export type GameId = "tictactoe" | "four" | "checkers" | "fleet";

export type Verdict = "ok" | string;

export interface GameModule<S> {
  id: GameId;
  start(firstSeat: Seat): S;
  turn(state: S): Seat;
  legalActions(state: S, seat: Seat): unknown[] | null;
  validate(state: S, seat: Seat, action: unknown): Verdict;
  apply(state: S, action: unknown): S;
  view(state: S, viewer: Viewer): unknown;
  outcome(state: S): Outcome;
}

export type TicTacToeView = {
  game: "tictactoe";
  cells: Array<"X" | "O" | null>;
  turn: Seat | null;
  lastCell: string | null;
  outcome: Outcome;
};

export type FourView = {
  game: "four";
  grid: Array<Array<"A" | "B" | null>>;
  turn: Seat | null;
  last: { column: number; row: number } | null;
  outcome: Outcome;
};

export type CheckersPiece = "red-man" | "red-king" | "white-man" | "white-king";

export type CheckersView = {
  game: "checkers";
  pieces: Record<string, CheckersPiece>;
  turn: Seat | null;
  lastPath: number[] | null;
  outcome: Outcome;
};

export type FleetShipView = {
  seat: Seat;
  length: number;
  cells: string[];
  sunk: boolean;
};

export type FleetView = {
  game: "fleet";
  phase: "place" | "shoot" | "done";
  turn: Seat | null;
  ships: FleetShipView[];
  shots: Array<{ seat: Seat; cell: string; hit: boolean }>;
  lastShot: { seat: Seat; cell: string } | null;
  outcome: Outcome;
};
