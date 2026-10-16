import type { GameModule, Seat, Viewer } from "../rules/types.js";
import { viewFor } from "./runner.js";

/** Derive metadata and visibility from the same prefix as the board. */
export function positionAt(
  game: GameModule<unknown>,
  firstSeat: Seat | null,
  events: Array<{ seq: number; type: string; payload: Record<string, unknown> }>,
  viewer: Viewer,
  seq: number,
) {
  const prefix = events.filter(event => event.seq <= seq);
  const names: Record<string, string> = {};
  let started = false;
  let result: Record<string, unknown> | null = null;
  for (const event of prefix) {
    if (event.type === "seated") {
      const { seat, displayName } = event.payload;
      if ((seat === 0 || seat === 1) && typeof displayName === "string") names[String(seat)] = displayName;
      if (seat === 1) started = true;
    } else if (event.type === "result") {
      const { result: outcome, winnerSeat, forfeitSeat, forfeitCause } = event.payload;
      result = { result: outcome, winnerSeat, forfeitSeat, forfeitCause };
    }
  }
  const historicalFirstSeat = started ? firstSeat : null;
  return { seq, view: viewFor(game, historicalFirstSeat, prefix, viewer), firstSeat: historicalFirstSeat, names, result };
}
