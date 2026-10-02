import type {
  CheckersPiece,
  CheckersView,
  GameModule,
  Outcome,
  Seat,
  Viewer,
} from "./types.js";

type Color = "red" | "white";

export type CheckersState = {
  board: (CheckersPiece | null)[];
  redSeat: Seat;
  turn: Seat;
  lastPath: number[] | null;
  quietRed: number;
  quietWhite: number;
  seen: Record<string, number>;
  result: Outcome;
};

type Setup = {
  firstSeat?: Seat;
  turn: Color;
  pieces: Partial<Record<number, CheckersPiece>>;
  quiet?: { red: number; white: number };
  seen?: Record<string, number>;
};

type Jump = { over: number; land: number };

function otherSeat(seat: Seat): Seat {
  return seat === 0 ? 1 : 0;
}

function colorToMove(state: CheckersState): Color {
  return state.turn === state.redSeat ? "red" : "white";
}

function pieceColor(piece: CheckersPiece): Color {
  return piece.startsWith("red") ? "red" : "white";
}

function isKing(piece: CheckersPiece): boolean {
  return piece.endsWith("king");
}

function rowCol(square: number): [number, number] {
  const row = Math.floor((square - 1) / 4);
  const index = (square - 1) % 4;
  const col = row % 2 === 0 ? index * 2 + 1 : index * 2;
  return [row, col];
}

function squareAt(row: number, col: number): number | null {
  if (row < 0 || row > 7 || col < 0 || col > 7) return null;
  if ((row + col) % 2 !== 1) return null;
  const index = row % 2 === 0 ? (col - 1) / 2 : col / 2;
  return row * 4 + index + 1;
}

function onKingRow(color: Color, square: number): boolean {
  return color === "red" ? square >= 29 : square <= 4;
}

function at(board: (CheckersPiece | null)[], square: number): CheckersPiece | null {
  return board[square] ?? null;
}

function emptyBoard(): (CheckersPiece | null)[] {
  return Array.from({ length: 33 }, () => null);
}

function directions(color: Color, king: boolean): Array<[number, number]> {
  const deltas: Array<[number, number]> = [];
  for (const rowDelta of [-1, 1]) {
    const forward = color === "red" ? rowDelta > 0 : rowDelta < 0;
    if (!king && !forward) continue;
    for (const colDelta of [-1, 1]) deltas.push([rowDelta, colDelta]);
  }
  return deltas;
}

function stepsFrom(square: number, color: Color, king: boolean): number[] {
  const [row, col] = rowCol(square);
  const squares: number[] = [];
  for (const [rowDelta, colDelta] of directions(color, king)) {
    const next = squareAt(row + rowDelta, col + colDelta);
    if (next !== null) squares.push(next);
  }
  return squares;
}

function jumpsFrom(square: number, color: Color, king: boolean): Jump[] {
  const [row, col] = rowCol(square);
  const jumps: Jump[] = [];
  for (const [rowDelta, colDelta] of directions(color, king)) {
    const over = squareAt(row + rowDelta, col + colDelta);
    const land = squareAt(row + 2 * rowDelta, col + 2 * colDelta);
    if (over !== null && land !== null) jumps.push({ over, land });
  }
  return jumps;
}

function comparePaths(left: number[], right: number[]): number {
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return left.length - right.length;
}

function capturePaths(
  board: (CheckersPiece | null)[],
  start: number,
  piece: CheckersPiece,
): number[][] {
  const color = pieceColor(piece);
  const lifted = board.slice();
  lifted[start] = null;
  const paths: number[][] = [];

  const walk = (square: number, captured: ReadonlySet<number>, path: number[]) => {
    // A man crowns on entering the king-row and cannot continue as a king.
    if (path.length > 1 && !isKing(piece) && onKingRow(color, square)) {
      paths.push(path);
      return;
    }
    const jumps: Jump[] = [];
    for (const jump of jumpsFrom(square, color, isKing(piece))) {
      if (captured.has(jump.over) || captured.has(jump.land)) continue;
      const victim = at(lifted, jump.over);
      if (victim === null || pieceColor(victim) === color) continue;
      if (at(lifted, jump.land) !== null) continue;
      jumps.push(jump);
    }
    if (jumps.length === 0) {
      if (path.length > 1) paths.push(path);
      return;
    }
    for (const jump of jumps) {
      const nextCaptured = new Set(captured);
      nextCaptured.add(jump.over);
      walk(jump.land, nextCaptured, path.concat(jump.land));
    }
  };

  walk(start, new Set(), [start]);
  return paths;
}

function quietPaths(
  board: (CheckersPiece | null)[],
  square: number,
  piece: CheckersPiece,
): number[][] {
  const paths: number[][] = [];
  for (const next of stepsFrom(square, pieceColor(piece), isKing(piece))) {
    if (at(board, next) === null) paths.push([square, next]);
  }
  return paths;
}

function allPaths(state: CheckersState): number[][] {
  if (state.result !== "ongoing") return [];
  const color = colorToMove(state);
  const captures: number[][] = [];
  const quiet: number[][] = [];
  for (let square = 1; square <= 32; square += 1) {
    const piece = at(state.board, square);
    if (piece === null || pieceColor(piece) !== color) continue;
    captures.push(...capturePaths(state.board, square, piece));
    quiet.push(...quietPaths(state.board, square, piece));
  }
  const paths = captures.length > 0 ? captures : quiet;
  paths.sort(comparePaths);
  return paths;
}

function samePath(left: number[], right: number[]): boolean {
  return left.length === right.length && left.every((square, index) => square === right[index]);
}

function isPathAction(action: unknown): action is { path: number[] } {
  if (action === null || typeof action !== "object") return false;
  const record = action as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length !== 1 || keys[0] !== "path") return false;
  const path = record.path;
  if (!Array.isArray(path) || path.length < 2) return false;
  return path.every((square) => Number.isInteger(square) && square >= 1 && square <= 32);
}

export function positionKey(state: CheckersState): string {
  let key = "";
  for (let square = 1; square <= 32; square += 1) {
    const piece = at(state.board, square);
    if (piece === null) key += ".";
    else if (piece === "red-man") key += "r";
    else if (piece === "red-king") key += "R";
    else if (piece === "white-man") key += "w";
    else key += "W";
  }
  return `${key}:${colorToMove(state) === "red" ? "r" : "w"}`;
}

function judge(state: CheckersState): CheckersState {
  const provisional: CheckersState = { ...state, result: "ongoing" };
  if (allPaths(provisional).length === 0) {
    return { ...provisional, result: { winner: otherSeat(provisional.turn) } };
  }
  if ((provisional.seen[positionKey(provisional)] ?? 0) >= 3) {
    return { ...provisional, result: "draw" };
  }
  if (provisional.quietRed >= 40 && provisional.quietWhite >= 40) {
    return { ...provisional, result: "draw" };
  }
  return provisional;
}

function recordCurrent(state: CheckersState): CheckersState {
  const key = positionKey(state);
  return {
    ...state,
    seen: { ...state.seen, [key]: (state.seen[key] ?? 0) + 1 },
  };
}

function finish(state: CheckersState): CheckersState {
  return judge(recordCurrent(state));
}

function place(pieces: Partial<Record<number, CheckersPiece>>): (CheckersPiece | null)[] {
  const board = emptyBoard();
  for (const [square, piece] of Object.entries(pieces)) {
    if (piece !== undefined) board[Number(square)] = piece;
  }
  return board;
}

function openingPieces(): Partial<Record<number, CheckersPiece>> {
  const pieces: Partial<Record<number, CheckersPiece>> = {};
  for (let square = 1; square <= 12; square += 1) pieces[square] = "red-man";
  for (let square = 21; square <= 32; square += 1) pieces[square] = "white-man";
  return pieces;
}

function startState(firstSeat: Seat): CheckersState {
  return finish({
    board: place(openingPieces()),
    redSeat: firstSeat,
    turn: firstSeat,
    lastPath: null,
    quietRed: 0,
    quietWhite: 0,
    seen: {},
    result: "ongoing",
  });
}

export function setup(input: Setup): CheckersState {
  const redSeat = input.firstSeat ?? 0;
  return finish({
    board: place(input.pieces),
    redSeat,
    turn: input.turn === "red" ? redSeat : otherSeat(redSeat),
    lastPath: null,
    quietRed: input.quiet?.red ?? 0,
    quietWhite: input.quiet?.white ?? 0,
    seen: { ...(input.seen ?? {}) },
    result: "ongoing",
  });
}

export function legalPathsFrom(state: CheckersState): number[][] {
  return allPaths(state);
}

export function openingPaths(side: Color): number[][] {
  if (side === "red") return legalPathsFrom(startState(0));
  return legalPathsFrom(setup({ turn: "white", pieces: openingPieces() }));
}

function applyPath(state: CheckersState, path: number[]): CheckersState {
  const board = state.board.slice();
  const start = path[0] ?? 0;
  const piece = at(board, start);
  if (piece === null) throw new Error("illegal move");
  board[start] = null;
  let captured = false;
  for (let index = 0; index < path.length - 1; index += 1) {
    const from = path[index] ?? 0;
    const to = path[index + 1] ?? 0;
    const [fromRow, fromCol] = rowCol(from);
    const [toRow, toCol] = rowCol(to);
    if (Math.abs(fromRow - toRow) === 2 && Math.abs(fromCol - toCol) === 2) {
      const mid = squareAt((fromRow + toRow) / 2, (fromCol + toCol) / 2);
      if (mid === null) throw new Error("illegal move");
      board[mid] = null;
      captured = true;
    }
  }
  const end = path[path.length - 1] ?? 0;
  const color = pieceColor(piece);
  const crowned = !isKing(piece) && onKingRow(color, end);
  board[end] = crowned ? (color === "red" ? "red-king" : "white-king") : piece;

  const quietKing = isKing(piece) && !captured;
  const quietRed = color === "red" ? (quietKing ? state.quietRed + 1 : 0) : state.quietRed;
  const quietWhite = color === "white" ? (quietKing ? state.quietWhite + 1 : 0) : state.quietWhite;

  return finish({
    board,
    redSeat: state.redSeat,
    turn: otherSeat(state.turn),
    lastPath: path.slice(),
    quietRed,
    quietWhite,
    seen: state.seen,
    result: "ongoing",
  });
}

function viewState(state: CheckersState, _viewer: Viewer): CheckersView {
  const pieces: Record<string, CheckersPiece> = {};
  for (let square = 1; square <= 32; square += 1) {
    const piece = at(state.board, square);
    if (piece !== null) pieces[String(square)] = piece;
  }
  return {
    game: "checkers",
    pieces,
    turn: state.result === "ongoing" ? state.turn : null,
    lastPath: state.lastPath === null ? null : state.lastPath.slice(),
    outcome: state.result,
  };
}

export const checkers: GameModule<CheckersState> = {
  id: "checkers",
  start: startState,
  turn: (state) => state.turn,
  legalActions(state, seat) {
    if (state.result !== "ongoing" || seat !== state.turn) return [];
    return allPaths(state).map((path) => ({ path }));
  },
  validate(state, seat, action) {
    if (state.result !== "ongoing") return "game over";
    if (seat !== state.turn) return "not your turn";
    if (!isPathAction(action)) return "illegal move";
    const legal = allPaths(state);
    if (!legal.some((path) => samePath(path, action.path))) return "illegal move";
    return "ok";
  },
  apply(state, action) {
    const verdict = checkers.validate(state, state.turn, action);
    if (verdict !== "ok" || !isPathAction(action)) throw new Error(verdict);
    return applyPath(state, action.path);
  },
  view: viewState,
  outcome: (state) => state.result,
};
