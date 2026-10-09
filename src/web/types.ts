import type { CheckersView, FleetView, FourView, Seat, TicTacToeView } from "../rules/types.js";

export type { Seat } from "../rules/types.js";
export type View = TicTacToeView | FourView | CheckersView | FleetView;
export type MatchResult = {
  result: "decided" | "draw" | "forfeit";
  winnerSeat: Seat | null;
  forfeitSeat: Seat | null;
  forfeitCause: string;
};
export type Boot = {
  matchId: string;
  seq: number;
  view: View | null;
  names: Record<string, string>;
  game: string;
  status?: "waiting" | "active" | "finished";
  firstSeat?: Seat | null;
  result?: MatchResult | null;
};
export type ShownEvent = { seq: number; type: string; payload: Record<string, unknown> };
export type FeedContext = Pick<Boot, "game" | "names" | "firstSeat" | "view">;

export function isSeat(value: unknown): value is Seat {
  return value === 0 || value === 1;
}

export function agentName(names: Record<string, string>, seat: Seat): string {
  return names[String(seat)] || `Seat ${seat + 1}`;
}
