import { describe, expect, it, vi } from "vitest";
import { timeline, type ActionConsequence } from "../../src/match/timeline.ts";
import { presentEvent } from "../../src/match/runner.ts";
import { games } from "../../src/rules/index.ts";
import type { GameModule, Seat, Viewer } from "../../src/rules/types.ts";
import { formatEvent } from "../../src/web/feed.ts";
import type { View } from "../../src/web/types.ts";

type Event = { seq: number; type: string; payload: Record<string, unknown> };
const roles = [0, 1].flatMap((firstSeat) => [0, 1, "spectator"].map((viewer) =>
  ({ firstSeat: firstSeat as Seat, viewer: viewer as Viewer })));

function history(game: GameModule<unknown>, firstSeat: Seat, actions: unknown[]) {
  let state = game.start(firstSeat);
  const events: Event[] = [
    { seq: 1, type: "seated", payload: { seat: 0, displayName: "Ada" } },
    { seq: 2, type: "seated", payload: { seat: 1, displayName: "Bea" } },
  ];
  for (const action of actions) {
    const seat = game.turn(state);
    expect(game.validate(state, seat, action)).toBe("ok");
    events.push({ seq: events.length + 1, type: "action", payload: { seat, action } });
    state = game.apply(state, action);
  }
  return { events, state };
}

function expectPrefixInvariant(game: GameModule<unknown>, firstSeat: Seat, events: Event[], viewer: Viewer) {
  const original = structuredClone(events);
  const reloaded = timeline(game, firstSeat, events, viewer);
  const live = events.map((_, index) => timeline(game, firstSeat, events.slice(0, index + 1), viewer).at(-1));
  expect(live).toEqual(reloaded);
  for (let length = 0; length <= events.length; length += 1) {
    expect(timeline(game, firstSeat, events.slice(0, length), viewer)).toEqual(reloaded.slice(0, length));
  }
  expect(events).toEqual(original);
  return reloaded;
}

// Legal from the standard opening: White crowns on the first double jump, Red on the second.
const checkersPaths = [
  [11, 16], [22, 17], [7, 11], [26, 22], [2, 7], [23, 19], [16, 23], [27, 18],
  [11, 15], [18, 11, 2], [12, 16], [31, 26], [10, 15], [17, 13], [8, 11],
  [22, 18], [15, 22, 31], [2, 7],
];
const quietCrowningPaths = [
  [9, 14], [24, 19], [12, 16], [19, 12], [5, 9], [22, 17], [14, 18], [23, 14, 5],
  [6, 9], [27, 24], [10, 15], [24, 19], [15, 24], [28, 19], [1, 6], [5, 1],
];

describe.each(roles)("timeline, first seat $firstSeat, viewer $viewer", ({ firstSeat, viewer }) => {
  it("counts actual Checkers losses and crowns only the moving man, identically on reload and live prefixes", () => {
    const { events, state } = history(games.checkers, firstSeat, checkersPaths.map((path) => ({ path })));
    const shown = expectPrefixInvariant(games.checkers, firstSeat, events, viewer);
    expect(shown.slice(0, 2).every((event) => event.consequence === undefined)).toBe(true);
    const actions = shown.slice(2);
    expect(actions.map((event) => event.consequence)).toEqual(checkersPaths.map((_, index) => ({
      captured: index === 6 || index === 7 ? 1 : index === 9 || index === 16 ? 2 : 0,
      promoted: index === 9 || index === 16,
    })));
    const context = { game: "checkers", names: {}, firstSeat, view: games.checkers.view(state, viewer) as View };
    expect(formatEvent(actions[0], context)).toMatchObject({ title: "Moved a piece", detail: "Path" });
    expect(formatEvent(actions[6], context).title).toBe("Captured 1 piece");
    for (const index of [9, 16]) {
      expect(formatEvent(actions[index], context)).toMatchObject({ title: "Captured 2 pieces", detail: "Promoted to king" });
    }
    // Moving a king again must not be counted as another promotion.
    expect(actions.at(-1)?.consequence).toEqual({ captured: 0, promoted: false });
  });

  it("detects a quiet Checkers promotion without calling it a capture", () => {
    const { events } = history(games.checkers, firstSeat, quietCrowningPaths.map((path) => ({ path })));
    const shown = expectPrefixInvariant(games.checkers, firstSeat, events, viewer).at(-1)!;
    expect(shown.consequence).toEqual({ captured: 0, promoted: true });
    expect(formatEvent(shown, { game: "checkers", names: {}, firstSeat, view: null }))
      .toMatchObject({ title: "Moved a piece", detail: "Promoted to king", coordinates: ["5", "1"] });
  });

  it("keeps both length-three Fleet sinks independent and every earlier hit stable through the final result", () => {
    const placements = [
      { ships: [ship("ABCDE", 1), ship("ABCD", 2), ship("ABC", 3), ship("ABC", 4), ship("AB", 5)] },
      { ships: [ship("FGHIJ", 6), ship("FGHI", 7), ship("FGH", 8), ship("FGH", 9), ship("IJ", 10)] },
    ];
    const enemy = placements[firstSeat === 0 ? 1 : 0];
    const own = placements[firstSeat];
    const targets = [
      { cell: "J5", consequence: { hit: false } },
      ...[2, 3, 0, 1, 4].flatMap((index) => enemy.ships[index].cells.map((cell, cellIndex) => ({
        cell,
        consequence: { hit: true, ...(cellIndex === enemy.ships[index].length - 1 ? { sunkLength: enemy.ships[index].length } : {}) },
      }))),
    ];
    const ownCells = own.ships.flatMap((ship) => ship.cells);
    const replies = [...own.ships[4].cells, ...boardCells().filter((cell) => !ownCells.includes(cell))];
    const actions: unknown[] = [...placements];
    const expected: Array<ActionConsequence | undefined> = [undefined, undefined];
    targets.forEach(({ cell, consequence }, index) => {
      actions.push({ cell });
      expected.push(consequence);
      if (index < targets.length - 1) {
        actions.push({ cell: replies[index] });
        expected.push(index === 0 ? { hit: true } : index === 1 ? { hit: true, sunkLength: 2 } : { hit: false });
      }
    });
    const { events, state } = history(games.fleet, firstSeat, actions);
    expect(games.fleet.outcome(state)).toEqual({ winner: firstSeat });
    events.push({ seq: events.length + 1, type: "result", payload: { result: "decided", winnerSeat: firstSeat } });
    const shown = expectPrefixInvariant(games.fleet, firstSeat, events, viewer);
    expect(shown.slice(2, -1).map((event) => event.consequence)).toEqual(expected);
    expect(shown.at(-1)?.consequence).toBeUndefined();
    const context = { game: "fleet", names: {}, firstSeat, view: games.fleet.view(state, viewer) as View };
    for (const event of shown) {
      expect(event.payload).toEqual(presentEvent(events[event.seq - 1], "fleet", viewer).payload);
      if (!event.consequence) continue;
      // Metadata is only scalar facts, with no ships, cells, views or other placement data.
      expect(Object.keys(event.consequence).every((key) => ["hit", "sunkLength"].includes(key))).toBe(true);
      expect(Object.values(event.consequence).every((value) => typeof value === "boolean" || typeof value === "number")).toBe(true);
      const { hit, sunkLength } = event.consequence;
      expect(formatEvent(event, context).title).toBe(sunkLength ? `Sank a ${sunkLength}-cell ship` : hit ? "Shot hit" : "Shot missed");
      expect(formatEvent(event, { ...context, view: null })).toEqual(formatEvent(event, context));
    }
    const attackEvents = shown.filter((event) => event.payload.seat === firstSeat && event.consequence);
    expect(attackEvents.filter((event) => event.consequence?.sunkLength === 3)).toHaveLength(2);
    expect(attackEvents[1].consequence).toEqual({ hit: true });
    expect(formatEvent(attackEvents[1], context).title).toBe("Shot hit");
    if (viewer !== "spectator") {
      const hidden = shown.find((event) => event.type === "action" && event.payload.seat !== viewer)!;
      expect(hidden).toEqual({ seq: viewer === 0 ? 4 : 3, type: "action", payload: { seat: viewer === 0 ? 1 : 0, action: { placed: true } } });
      const ownPlacement = shown.find((event) => event.type === "action" && event.payload.seat === viewer)!;
      expect(ownPlacement.payload.action).toEqual(placements[viewer]);
    }
  });
});

function ship(columns: string, row: number) {
  return { length: columns.length, cells: [...columns].map((column) => `${column}${row}`) };
}

function boardCells(): string[] {
  return Array.from({ length: 100 }, (_, index) => `${String.fromCharCode(65 + index % 10)}${Math.floor(index / 10) + 1}`);
}

describe("timeline lifecycle and other games", () => {
  it("presents a waiting match without starting or applying any game effects", () => {
    const game = { ...games.fleet, start: vi.fn(games.fleet.start), apply: vi.fn(games.fleet.apply), view: vi.fn(games.fleet.view) };
    const events: Event[] = [{ seq: 1, type: "seated", payload: { seat: 0, displayName: "Ada" } }];
    expect(timeline(game, null, [], 0)).toEqual([]);
    expect(timeline(game, null, events, "spectator")).toEqual(events);
    expect(game.start).not.toHaveBeenCalled();
    expect(game.apply).not.toHaveBeenCalled();
    expect(game.view).not.toHaveBeenCalled();
  });

  it.each(["tictactoe", "four"] as const)("preserves %s actions and lifecycle events without consequences", (id) => {
    const game = games[id];
    const { events } = history(game, 1, id === "four" ? [{ column: 7 }, { column: 1 }] : [{ cell: "r1c1" }, { cell: "r2c2" }]);
    events.splice(2, 0, { seq: 3, type: "unknown", payload: { action: { cell: "invalid" } } });
    events.forEach((event, index) => { event.seq = index + 1; });
    events.push({ seq: 6, type: "result", payload: { result: "forfeit", winnerSeat: 1 } });
    expect(expectPrefixInvariant(game, 1, events, 0)).toEqual(events);
  });
});
