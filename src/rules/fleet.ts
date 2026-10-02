import type { FleetView, GameModule, Outcome, Seat, Verdict, Viewer } from "./types.js";

type Ship = {
  length: number;
  cells: string[];
};

type Shot = {
  seat: Seat;
  cell: string;
  hit: boolean;
};

type FleetState = {
  firstSeat: Seat;
  fleets: [Ship[], Ship[]];
  shots: Shot[];
  winner: Seat | null;
};

const COLUMNS = "ABCDEFGHIJ";
const FLEET_LENGTHS = [2, 3, 3, 4, 5];

function other(seat: Seat): Seat {
  return seat === 0 ? 1 : 0;
}

function parseCell(cell: string): { col: number; row: number } | null {
  const match = /^([A-J])([1-9]|10)$/.exec(cell);
  if (!match) return null;
  return { col: match[1].charCodeAt(0) - 65, row: Number(match[2]) - 1 };
}

function cellKey(cell: string): number {
  const col = cell.charCodeAt(0) - 65;
  const row = Number(cell.slice(1)) - 1;
  return row * 10 + col;
}

function adjacent(values: number[]): boolean {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.every((value, index) => index === 0 || value === sorted[index - 1] + 1);
}

function readShip(value: unknown): { ship: Ship } | { error: string } {
  if (typeof value !== "object" || value === null) {
    return { error: "Each ship needs a length and cells." };
  }
  const length = (value as { length?: unknown }).length;
  const cells = (value as { cells?: unknown }).cells;
  if (typeof length !== "number" || !Number.isInteger(length)) {
    return { error: "Each ship needs a length and cells." };
  }
  if (!Array.isArray(cells) || cells.length !== length) {
    return { error: "A ship's length must match its cells." };
  }
  const names: string[] = [];
  const points: Array<{ col: number; row: number }> = [];
  for (const cell of cells) {
    if (typeof cell !== "string") return { error: "A ship is off the board." };
    const point = parseCell(cell);
    if (!point) return { error: "A ship is off the board." };
    names.push(cell);
    points.push(point);
  }
  if (new Set(names).size !== names.length) return { error: "A ship repeats a cell." };
  const cols = new Set(points.map((point) => point.col));
  const rows = new Set(points.map((point) => point.row));
  const straight =
    (rows.size === 1 && cols.size === length && adjacent(points.map((point) => point.col))) ||
    (cols.size === 1 && rows.size === length && adjacent(points.map((point) => point.row)));
  if (!straight) {
    return { error: "A ship must be a straight horizontal or vertical line of adjacent cells." };
  }
  return { ship: { length, cells: names } };
}

function readPlacement(action: unknown): { ships: Ship[] } | { error: string } {
  if (typeof action !== "object" || action === null || !("ships" in action)) {
    return { error: "A placement must list five ships." };
  }
  const ships = (action as { ships: unknown }).ships;
  if (!Array.isArray(ships) || ships.length !== 5) {
    return { error: "A fleet has exactly five ships." };
  }
  const parsed: Ship[] = [];
  for (const ship of ships) {
    const result = readShip(ship);
    if ("error" in result) return result;
    parsed.push(result.ship);
  }
  const lengths = parsed.map((ship) => ship.length).sort((a, b) => a - b);
  if (lengths.some((length, index) => length !== FLEET_LENGTHS[index])) {
    if (parsed.filter((ship) => ship.length === 5).length > 1) {
      return { error: "Two ships of length 5 are illegal." };
    }
    return { error: "The fleet must contain ships of lengths 5, 4, 3, 3, and 2." };
  }
  const occupied = new Set<string>();
  for (const ship of parsed) {
    for (const cell of ship.cells) {
      if (occupied.has(cell)) return { error: "Ships overlap." };
      occupied.add(cell);
    }
  }
  return { ships: parsed };
}

function canonicalShips(ships: Ship[]): Ship[] {
  return ships
    .map((ship) => ({
      length: ship.length,
      cells: [...ship.cells].sort((a, b) => cellKey(a) - cellKey(b)),
    }))
    .sort((a, b) => {
      if (a.length !== b.length) return b.length - a.length;
      for (let index = 0; index < a.cells.length; index++) {
        const diff = cellKey(a.cells[index]) - cellKey(b.cells[index]);
        if (diff !== 0) return diff;
      }
      return 0;
    });
}

function shotsBy(state: FleetState, seat: Seat): Set<string> {
  return new Set(state.shots.filter((shot) => shot.seat === seat).map((shot) => shot.cell));
}

function bothPlaced(state: FleetState): boolean {
  return state.fleets[0].length > 0 && state.fleets[1].length > 0;
}

function turn(state: FleetState): Seat {
  if (state.winner !== null) return state.winner;
  if (state.fleets[0].length === 0) return 0;
  if (state.fleets[1].length === 0) return 1;
  return state.shots.length % 2 === 0 ? state.firstSeat : other(state.firstSeat);
}

function phase(state: FleetState): FleetView["phase"] {
  if (state.winner !== null) return "done";
  if (!bothPlaced(state)) return "place";
  return "shoot";
}

function sunk(ship: Ship, hits: Set<string>): boolean {
  return ship.cells.every((cell) => hits.has(cell));
}

function start(firstSeat: Seat): FleetState {
  return {
    firstSeat,
    fleets: [[], []],
    shots: [],
    winner: null,
  };
}

function legalActions(state: FleetState, seat: Seat): unknown[] | null {
  if (state.winner !== null) return [];
  if (!bothPlaced(state)) return null;
  const fired = shotsBy(state, seat);
  const actions: Array<{ cell: string }> = [];
  for (let row = 1; row <= 10; row++) {
    for (let col = 0; col < COLUMNS.length; col++) {
      const cell = `${COLUMNS[col]}${row}`;
      if (!fired.has(cell)) actions.push({ cell });
    }
  }
  return actions;
}

function validate(state: FleetState, seat: Seat, action: unknown): Verdict {
  if (state.winner !== null) return "The game is over.";
  if (seat !== turn(state)) return "It is not this seat's turn.";
  if (!bothPlaced(state)) {
    const placement = readPlacement(action);
    return "error" in placement ? placement.error : "ok";
  }
  if (typeof action !== "object" || action === null || !("cell" in action)) {
    return "A shot must name a cell.";
  }
  const cell = (action as { cell: unknown }).cell;
  if (typeof cell !== "string" || parseCell(cell) === null) return "A shot must name a board cell.";
  if (shotsBy(state, seat).has(cell)) return "That cell was already shot.";
  return "ok";
}

function apply(state: FleetState, action: unknown): FleetState {
  const seat = turn(state);
  const verdict = validate(state, seat, action);
  if (verdict !== "ok") throw new Error(verdict);
  if (!bothPlaced(state)) {
    const placement = readPlacement(action);
    if ("error" in placement) throw new Error(placement.error);
    const placed = canonicalShips(placement.ships);
    const fleets: [Ship[], Ship[]] =
      seat === 0 ? [placed, state.fleets[1]] : [state.fleets[0], placed];
    return { firstSeat: state.firstSeat, fleets, shots: state.shots, winner: null };
  }
  const cell = (action as { cell: string }).cell;
  const enemy = other(seat);
  const hit = state.fleets[enemy].some((ship) => ship.cells.includes(cell));
  const shots = [...state.shots, { seat, cell, hit }];
  const fired = new Set(shots.filter((shot) => shot.seat === seat).map((shot) => shot.cell));
  const won = state.fleets[enemy].every((ship) => sunk(ship, fired));
  return {
    firstSeat: state.firstSeat,
    fleets: state.fleets,
    shots,
    winner: won ? seat : null,
  };
}

function outcome(state: FleetState): Outcome {
  return state.winner === null ? "ongoing" : { winner: state.winner };
}

function view(state: FleetState, viewer: Viewer): FleetView {
  const ships: FleetView["ships"] = [];
  for (const seat of [0, 1] as const) {
    const hits = shotsBy(state, other(seat));
    for (const ship of state.fleets[seat]) {
      const isSunk = sunk(ship, hits);
      if (viewer !== "spectator" && viewer !== seat && !isSunk) continue;
      ships.push({
        seat,
        length: ship.length,
        cells: [...ship.cells],
        sunk: isSunk,
      });
    }
  }
  const last = state.shots[state.shots.length - 1];
  return {
    game: "fleet",
    phase: phase(state),
    turn: state.winner === null ? turn(state) : null,
    ships,
    shots: state.shots.map((shot) => ({ seat: shot.seat, cell: shot.cell, hit: shot.hit })),
    lastShot: last === undefined ? null : { seat: last.seat, cell: last.cell },
    outcome: outcome(state),
  };
}

export const fleet: GameModule<FleetState> = {
  id: "fleet",
  start,
  turn,
  legalActions,
  validate,
  apply,
  view,
  outcome,
};
