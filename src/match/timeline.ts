import type { CheckersView, FleetView, GameModule, Seat, Viewer } from "../rules/types.js";
import { presentEvent } from "./runner.js";

export type ActionConsequence = {
  captured?: number;
  promoted?: boolean;
  hit?: boolean;
  sunkLength?: number;
};

type Event = { seq: number; type: string; payload: Record<string, unknown> };

function checkersConsequence(before: CheckersView, after: CheckersView): ActionConsequence {
  const path = after.lastPath ?? [];
  const origin = before.pieces[String(path[0])];
  const destination = after.pieces[String(path.at(-1))];
  return {
    captured: Object.keys(before.pieces).length - Object.keys(after.pieces).length,
    promoted: (origin === "red-man" && destination === "red-king")
      || (origin === "white-man" && destination === "white-king"),
  };
}

function fleetConsequence(before: FleetView, after: FleetView): ActionConsequence | undefined {
  const shot = after.shots.at(-1);
  if (!shot || before.shots.some((prior) => prior.seat === shot.seat && prior.cell === shot.cell)) return;
  const sunk = after.ships.find((ship) => ship.seat !== shot.seat && ship.sunk && ship.cells.includes(shot.cell)
    && !before.ships.some((prior) => prior.seat === ship.seat && prior.sunk
      && prior.cells.length === ship.cells.length && prior.cells.every((cell) => ship.cells.includes(cell))));
  return { hit: shot.hit, ...(sunk ? { sunkLength: sunk.length } : {}) };
}

/** Present each event using only the viewer's positions immediately around that action. */
export function timeline(
  game: GameModule<unknown>,
  firstSeat: Seat | null,
  events: Array<{ seq: number; type: string; payload: Record<string, unknown> }>,
  viewer: Viewer,
): Array<Event & { consequence?: ActionConsequence }> {
  let state = firstSeat === null ? undefined : game.start(firstSeat);
  return events.map((event) => {
    const shown = presentEvent(event, game.id, viewer);
    if (firstSeat === null || event.type !== "action" || event.payload.action === undefined) return shown;
    const before = game.view(state, viewer);
    state = game.apply(state, event.payload.action);
    const after = game.view(state, viewer);
    const consequence = game.id === "checkers" ? checkersConsequence(before as CheckersView, after as CheckersView)
      : game.id === "fleet" ? fleetConsequence(before as FleetView, after as FleetView) : undefined;
    return consequence === undefined ? shown : { ...shown, consequence };
  });
}
