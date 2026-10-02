import { describe, expect, it } from "vitest";
import { fleet } from "../../src/rules/fleet.ts";
import type { FleetView, Seat } from "../../src/rules/types.ts";

type State = ReturnType<typeof fleet.start>;

type Ship = { length: number; cells: string[] };
type Placement = { ships: Ship[] };

function hShip(row: number, length: number, startCol = 0): Ship {
  return {
    length,
    cells: Array.from(
      { length },
      (_, index) => `${String.fromCharCode(65 + startCol + index)}${row}`,
    ),
  };
}

function vShip(col: string, startRow: number, length: number): Ship {
  return {
    length,
    cells: Array.from({ length }, (_, index) => `${col}${startRow + index}`),
  };
}

function replaceShip(base: Placement, index: number, ship: Ship): Placement {
  return {
    ships: base.ships.map((current, shipIndex) =>
      shipIndex === index ? ship : { length: current.length, cells: [...current.cells] },
    ),
  };
}

/** Separated ships, including the vertical carrier A1–A5 and row 10. */
const legal: Placement = {
  ships: [
    vShip("A", 1, 5),
    hShip(7, 4),
    hShip(9, 3),
    vShip("J", 1, 3),
    hShip(10, 2, 3),
  ],
};

/** Consecutive rows share sides. */
const touching: Placement = {
  ships: [hShip(1, 5), hShip(2, 4), hShip(3, 3), hShip(4, 3), hShip(5, 2)],
};

/** No cell in common with `legal`, so a leaked opponent cell cannot be an own ship. */
const east: Placement = {
  ships: [hShip(2, 5, 4), hShip(4, 4, 5), hShip(6, 3, 5), hShip(8, 3, 5), hShip(10, 2, 7)],
};

const overlap = replaceShip(legal, 1, vShip("A", 1, 4));
const diagonal = replaceShip(legal, 2, { length: 3, cells: ["B2", "C3", "D4"] });
const offBoard = replaceShip(legal, 4, { length: 2, cells: ["J10", "K10"] });
const gap: Placement = {
  ships: [
    hShip(6, 5),
    hShip(8, 4),
    { length: 3, cells: ["A1", "A2", "A4"] },
    hShip(10, 3),
    vShip("J", 1, 2),
  ],
};
const missingLength = replaceShip(legal, 4, hShip(10, 4, 3));
const twoLengthFive = replaceShip(legal, 1, hShip(7, 5));
const sixth: Placement = { ships: [...legal.ships, hShip(8, 2)] };

function byCell(a: string, b: string): number {
  const row = Number(a.slice(1)) - Number(b.slice(1));
  if (row !== 0) return row;
  return a.charCodeAt(0) - b.charCodeAt(0);
}

function cellsOf(placement: Placement): string[] {
  return placement.ships.flatMap((ship) => ship.cells).sort(byCell);
}

function stringsIn(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(stringsIn);
  if (value && typeof value === "object") return Object.values(value).flatMap(stringsIn);
  return [];
}

function observe(state: State, viewer: Seat | "spectator"): FleetView {
  return fleet.view(state, viewer) as FleetView;
}

function shipCells(view: FleetView, seat: Seat): string[] {
  return view.ships.filter((ship) => ship.seat === seat).flatMap((ship) => ship.cells).sort(byCell);
}

function findShip(view: FleetView, seat: Seat, cells: string[]): FleetView["ships"][number] | undefined {
  const want = [...cells].sort(byCell).join(",");
  return view.ships.find(
    (ship) => ship.seat === seat && [...ship.cells].sort(byCell).join(",") === want,
  );
}

function placeBoth(first: Seat, seat0: Placement = touching, seat1: Placement = touching): State {
  return fleet.apply(fleet.apply(fleet.start(first), seat0), seat1);
}

function sunkCount(state: State, seat: Seat): number {
  return observe(state, "spectator").ships.filter((ship) => ship.seat === seat && ship.sunk).length;
}

describe("fleet", () => {
  it("is the fleet rules module", () => {
    expect(fleet.id).toBe("fleet");
  });

  it("accepts a legal placement and lets seat 0 place before seat 1", () => {
    const start = fleet.start(1);
    expect(fleet.turn(start)).toBe(0);
    expect(observe(start, 0)).toMatchObject({
      game: "fleet",
      phase: "place",
      turn: 0,
      ships: [],
      shots: [],
      lastShot: null,
      outcome: "ongoing",
    });
    expect(fleet.legalActions(start, 0)).toBeNull();
    expect(fleet.legalActions(start, 1)).toBeNull();
    expect(fleet.outcome(start)).toBe("ongoing");

    expect(fleet.validate(start, 0, legal)).toBe("ok");
    expect(fleet.validate(start, 1, legal)).not.toBe("ok");

    const action = {
      ships: legal.ships.map((ship) => ({ length: ship.length, cells: [...ship.cells] })),
    };
    const before = structuredClone(action);
    const placed = fleet.apply(start, action);
    expect(action).toEqual(before);
    expect(start).toEqual(fleet.start(1));

    const seat0 = observe(placed, 0);
    expect(seat0.phase).toBe("place");
    expect(seat0.turn).toBe(1);
    expect(fleet.turn(placed)).toBe(1);
    expect(shipCells(seat0, 0)).toEqual(cellsOf(legal));
    expect(seat0.ships.every((ship) => ship.sunk === false)).toBe(true);
    expect(fleet.legalActions(placed, 0)).toBeNull();
    expect(fleet.legalActions(placed, 1)).toBeNull();
    expect(fleet.validate(placed, 1, touching)).toBe("ok");
    expect(fleet.validate(placed, 0, touching)).not.toBe("ok");
  });

  it("accepts ships that touch", () => {
    const start = fleet.start(0);
    expect(fleet.validate(start, 0, touching)).toBe("ok");
    const placed = fleet.apply(start, touching);
    expect(shipCells(observe(placed, 0), 0)).toEqual(cellsOf(touching));
  });

  it("rejects overlapping ships", () => {
    const start = fleet.start(0);
    expect(fleet.validate(start, 0, overlap)).not.toBe("ok");
    expect(() => fleet.apply(start, overlap)).toThrow();
  });

  it("rejects a diagonal ship", () => {
    const start = fleet.start(0);
    expect(fleet.validate(start, 0, diagonal)).not.toBe("ok");
    expect(() => fleet.apply(start, diagonal)).toThrow();
  });

  it("rejects an off-board cell", () => {
    const start = fleet.start(0);
    expect(fleet.validate(start, 0, offBoard)).not.toBe("ok");
    expect(() => fleet.apply(start, offBoard)).toThrow();
  });

  it("rejects a gap in a length-3 ship (A1, A2, A4)", () => {
    const start = fleet.start(0);
    expect(fleet.validate(start, 0, gap)).not.toBe("ok");
    expect(() => fleet.apply(start, gap)).toThrow();
  });

  it("rejects a fleet that is missing a required length", () => {
    const start = fleet.start(0);
    expect(fleet.validate(start, 0, missingLength)).not.toBe("ok");
    expect(() => fleet.apply(start, missingLength)).toThrow();
  });

  it("rejects two ships of length 5", () => {
    const start = fleet.start(0);
    expect(fleet.validate(start, 0, twoLengthFive)).not.toBe("ok");
    expect(() => fleet.apply(start, twoLengthFive)).toThrow();
  });

  it("rejects a sixth ship", () => {
    const start = fleet.start(0);
    expect(fleet.validate(start, 0, sixth)).not.toBe("ok");
    expect(() => fleet.apply(start, sixth)).toThrow();
  });

  it("accepts the same ships and cells in a different order", () => {
    const start = fleet.start(0);
    const reordered: Placement = {
      ships: [...legal.ships].reverse().map((ship) => ({
        length: ship.length,
        cells: [...ship.cells].reverse(),
      })),
    };
    expect(fleet.validate(start, 0, reordered)).toBe("ok");
    expect(fleet.apply(start, reordered)).toEqual(fleet.apply(start, legal));
  });

  it("gives the first shot to firstSeat and lists every unshot cell", () => {
    for (const first of [0, 1] as const) {
      const state = placeBoth(first);
      expect(fleet.turn(state)).toBe(first);
      expect(observe(state, first).phase).toBe("shoot");
      expect(observe(state, first).turn).toBe(first);
      const actions = fleet.legalActions(state, first);
      expect(actions).toHaveLength(100);
      expect(actions).toContainEqual({ cell: "A1" });
      expect(actions).toContainEqual({ cell: "J10" });
      expect(actions?.every((action) => Object.keys(action as object).join() === "cell")).toBe(true);
      expect(fleet.validate(state, first, { cell: "J10" })).toBe("ok");
      for (const cell of ["A0", "A11", "K1", "a1", "B07"]) {
        expect(fleet.validate(state, first, { cell })).not.toBe("ok");
      }
    }
  });

  it("records a miss and passes the turn", () => {
    const state = placeBoth(0);
    const next = fleet.apply(state, { cell: "J10" });
    const view = observe(next, 0);
    expect(view.shots).toEqual([{ seat: 0, cell: "J10", hit: false }]);
    expect(view.lastShot).toEqual({ seat: 0, cell: "J10" });
    expect(view.ships.every((ship) => ship.sunk === false)).toBe(true);
    expect(fleet.turn(next)).toBe(1);
    expect(view.turn).toBe(1);
    expect(view.phase).toBe("shoot");
    expect(fleet.outcome(next)).toBe("ongoing");
  });

  it("records a hit and passes the turn", () => {
    const state = placeBoth(0);
    const next = fleet.apply(state, { cell: "A1" });
    const view = observe(next, 0);
    expect(view.shots).toEqual([{ seat: 0, cell: "A1", hit: true }]);
    expect(view.lastShot).toEqual({ seat: 0, cell: "A1" });
    expect(fleet.turn(next)).toBe(1);
    expect(view.turn).toBe(1);
    expect(view.phase).toBe("shoot");
    expect(findShip(view, 1, ["A1", "B1", "C1", "D1", "E1"])).toBeUndefined();
    expect(shipCells(view, 0).includes("A1")).toBe(true);
    expect(view.ships.filter((ship) => ship.seat === 0).every((ship) => ship.sunk === false)).toBe(true);
  });

  it("leaves a cell already shot out of that seat's legal shots", () => {
    let state = placeBoth(0);
    state = fleet.apply(state, { cell: "J10" });
    expect(fleet.legalActions(state, 0)).not.toContainEqual({ cell: "J10" });
    expect(fleet.legalActions(state, 0)).toHaveLength(99);
    expect(fleet.legalActions(state, 1)).toContainEqual({ cell: "J10" });
    expect(fleet.legalActions(state, 1)).toHaveLength(100);

    state = fleet.apply(state, { cell: "J9" });
    expect(fleet.turn(state)).toBe(0);
    expect(fleet.legalActions(state, 0)).not.toContainEqual({ cell: "J10" });
    expect(fleet.validate(state, 0, { cell: "J10" })).not.toBe("ok");
    expect(() => fleet.apply(state, { cell: "J10" })).toThrow();
    expect(fleet.validate(state, 0, { cell: "J8" })).toBe("ok");
  });

  it("sinks each length-3 ship on its own", () => {
    let state = placeBoth(0);
    const misses = ["J1", "J2", "J3", "J4", "J5"];
    let miss = 0;
    const strike = (cell: string) => {
      expect(fleet.turn(state)).toBe(0);
      state = fleet.apply(state, { cell });
      expect(fleet.turn(state)).toBe(1);
    };
    const answer = () => {
      state = fleet.apply(state, { cell: misses[miss++] });
      expect(fleet.turn(state)).toBe(0);
    };

    strike("A3");
    let view = observe(state, 0);
    expect(view.shots.at(-1)).toEqual({ seat: 0, cell: "A3", hit: true });
    expect(view.ships.filter((ship) => ship.seat === 1)).toEqual([]);
    answer();

    strike("B3");
    answer();
    strike("C3");

    view = observe(state, 0);
    const sunk = findShip(view, 1, ["A3", "B3", "C3"]);
    expect(sunk).toMatchObject({ seat: 1, length: 3, sunk: true });
    expect(sunk?.cells.sort(byCell)).toEqual(["A3", "B3", "C3"]);
    expect(findShip(view, 1, ["A4", "B4", "C4"])).toBeUndefined();
    for (const cell of ["A4", "B4", "C4", "A1", "E1"]) {
      expect(shipCells(view, 1)).not.toContain(cell);
    }
    expect(view.ships.filter((ship) => ship.seat === 0).every((ship) => ship.sunk === false)).toBe(true);
    expect(sunkCount(state, 1)).toBe(1);
    expect(sunkCount(state, 0)).toBe(0);
    expect(fleet.outcome(state)).toBe("ongoing");
    expect(fleet.turn(state)).toBe(1);
    answer();

    strike("A4");
    view = observe(state, 0);
    expect(findShip(view, 1, ["A3", "B3", "C3"])?.sunk).toBe(true);
    expect(findShip(view, 1, ["A4", "B4", "C4"])).toBeUndefined();
    expect(shipCells(view, 1)).toEqual(["A3", "B3", "C3"]);
    expect(view.shots.at(-1)).toEqual({ seat: 0, cell: "A4", hit: true });
    answer();
    strike("B4");
    answer();
    strike("C4");

    view = observe(state, 0);
    expect(findShip(view, 1, ["A3", "B3", "C3"])).toMatchObject({ length: 3, sunk: true });
    expect(findShip(view, 1, ["A4", "B4", "C4"])).toMatchObject({ length: 3, sunk: true });
    expect(shipCells(view, 1)).not.toContain("A1");
    expect(view.ships.filter((ship) => ship.seat === 1)).toHaveLength(2);
    expect(view.ships.filter((ship) => ship.seat === 0).every((ship) => ship.sunk === false)).toBe(true);
    expect(observe(state, "spectator").ships.filter((ship) => ship.sunk)).toHaveLength(2);
    expect(view.lastShot).toEqual({ seat: 0, cell: "C4" });
    expect(view.phase).toBe("shoot");
    expect(fleet.outcome(state)).toBe("ongoing");
    expect(fleet.turn(state)).toBe(1);
  });

  it.each([0, 1] as const)(
    "seat %s wins when that seat sinks the fifth opposing ship",
    (first) => {
      let state = placeBoth(first);
      const target: Seat = first === 0 ? 1 : 0;
      const cells = touching.ships.flatMap((ship) => ship.cells);
      const quiet = allBoardCells().filter((cell) => !cells.includes(cell));
      let miss = 0;
      for (let index = 0; index < cells.length; index++) {
        expect(fleet.turn(state)).toBe(first);
        expect(fleet.outcome(state)).toBe("ongoing");
        if (index === cells.length - 1) expect(sunkCount(state, target)).toBe(4);
        state = fleet.apply(state, { cell: cells[index] });
        if (index === cells.length - 1) break;
        expect(fleet.outcome(state)).toBe("ongoing");
        expect(fleet.turn(state)).toBe(first === 0 ? 1 : 0);
        state = fleet.apply(state, { cell: quiet[miss++] });
        expect(fleet.outcome(state)).toBe("ongoing");
      }

      expect(sunkCount(state, target)).toBe(5);
      expect(sunkCount(state, first)).toBe(0);
      expect(fleet.outcome(state)).toEqual({ winner: first });
      const done = observe(state, first);
      expect(done.phase).toBe("done");
      expect(done.turn).toBeNull();
      expect(done.outcome).toEqual({ winner: first });
      expect(done.lastShot).toEqual({ seat: first, cell: cells.at(-1) });
      expect(shipCells(done, target)).toEqual([...cells].sort(byCell));
      expect(done.ships.filter((ship) => ship.seat === target).every((ship) => ship.sunk)).toBe(true);
      expect(fleet.legalActions(state, 0)).toEqual([]);
      expect(fleet.legalActions(state, 1)).toEqual([]);
      expect(fleet.validate(state, first, { cell: quiet[0] })).not.toBe("ok");
      expect(() => fleet.apply(state, { cell: quiet[0] })).toThrow();
    },
  );

  it("omits an opponent's unhit ship cells from a seat view", () => {
    let state = placeBoth(0, legal, east);
    const seat0 = observe(state, 0);
    const seat1 = observe(state, 1);
    expect(seat0.ships.every((ship) => ship.seat === 0)).toBe(true);
    expect(shipCells(seat0, 0)).toEqual(cellsOf(legal));
    for (const cell of cellsOf(east)) {
      expect(stringsIn(seat0)).not.toContain(cell);
    }
    expect(shipCells(seat1, 1)).toEqual(cellsOf(east));
    for (const cell of cellsOf(legal)) {
      expect(stringsIn(seat1)).not.toContain(cell);
    }

    state = fleet.apply(state, { cell: "E2" });
    const afterHit = observe(state, 0);
    expect(afterHit.shots).toEqual([{ seat: 0, cell: "E2", hit: true }]);
    expect(afterHit.ships.every((ship) => ship.seat === 0)).toBe(true);
    for (const cell of ["F2", "G2", "H2", "I2"]) {
      expect(stringsIn(afterHit)).not.toContain(cell);
    }
  });

  it("hides the first placement from the second placer", () => {
    const state = fleet.apply(fleet.start(1), legal);
    const second = observe(state, 1);
    expect(second.phase).toBe("place");
    expect(second.turn).toBe(1);
    expect(second.ships).toEqual([]);
    for (const cell of cellsOf(legal)) {
      expect(stringsIn(second)).not.toContain(cell);
    }
    const spectator = observe(state, "spectator");
    expect(shipCells(spectator, 0)).toEqual(cellsOf(legal));
    expect(spectator.ships.filter((ship) => ship.seat === 1)).toEqual([]);
  });

  it("shows both fleets to a spectator, including ships that are not sunk", () => {
    const state = placeBoth(0, legal, touching);
    const spectator = observe(state, "spectator");
    expect(spectator.phase).toBe("shoot");
    expect(spectator.ships).toHaveLength(10);
    expect(shipCells(spectator, 0)).toEqual(cellsOf(legal));
    expect(shipCells(spectator, 1)).toEqual(cellsOf(touching));
    expect(spectator.ships.every((ship) => ship.sunk === false)).toBe(true);
    expect(spectator.shots).toEqual([]);
    expect(spectator.lastShot).toBeNull();
  });
});

function allBoardCells(): string[] {
  const cells: string[] = [];
  for (let row = 1; row <= 10; row++) {
    for (let col = 0; col < 10; col++) {
      cells.push(`${String.fromCharCode(65 + col)}${row}`);
    }
  }
  return cells;
}
