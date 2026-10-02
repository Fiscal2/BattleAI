import type { GameId, GameModule, Seat } from "./types.js";
import { checkers } from "./checkers.js";
import { fleet } from "./fleet.js";
import { four } from "./four.js";
import { tictactoe } from "./tictactoe.js";

export const games: Record<GameId, GameModule<unknown>> = {
  tictactoe: tictactoe as GameModule<unknown>,
  four: four as GameModule<unknown>,
  checkers: checkers as GameModule<unknown>,
  fleet: fleet as GameModule<unknown>,
};

export function gameById(id: string): GameModule<unknown> | undefined {
  if (id === "tictactoe" || id === "four" || id === "checkers" || id === "fleet") {
    return games[id];
  }
  return undefined;
}

export function isGameId(id: string): id is GameId {
  return gameById(id) !== undefined;
}

export function fold(
  game: GameModule<unknown>,
  firstSeat: Seat,
  events: Array<{ type: string; payload: { action?: unknown } }>,
): unknown {
  let state = game.start(firstSeat);
  for (const event of events) {
    if (event.type === "action" && event.payload.action !== undefined) {
      state = game.apply(state, event.payload.action);
    }
  }
  return state;
}
