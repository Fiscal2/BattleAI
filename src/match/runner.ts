import { actionsEqual } from "../rules/actions.js";
import { fold } from "../rules/index.js";
import type { GameId, GameModule, Outcome, Seat } from "../rules/types.js";
import { parseAction } from "../model/parse.js";
import type { ChatMessage, Completion } from "../model/client.js";
import type { EventRow, Store } from "../store/db.js";

export type Completer = (messages: ChatMessage[]) => Promise<Completion>;

export type Published = {
  event: { seq: number; type: string; payload: unknown };
  view: unknown;
};

const PLACEMENT_RULE =
  'Place five ships of lengths 5, 4, 3, 3, and 2. Each ship is adjacent cells in a straight horizontal or vertical line. Columns are A-J and rows are 1-10. Ships may touch. They may not overlap, leave the board, go diagonal, or contain a gap. Return {"ships":[{"length":5,"cells":["A1","A2","A3","A4","A5"]}]} and the other four ships.';

export function otherSeat(seat: Seat): Seat {
  return seat === 0 ? 1 : 0;
}

export function presentEvent(
  event: { seq: number; type: string; payload: Record<string, unknown> },
  gameId: GameId,
  viewer: Seat | "spectator",
) {
  const action = event.payload.action as { ships?: unknown } | undefined;
  if (
    gameId === "fleet" &&
    viewer !== "spectator" &&
    event.type === "action" &&
    action &&
    Array.isArray(action.ships) &&
    event.payload.seat !== viewer
  ) {
    return {
      seq: event.seq,
      type: event.type,
      payload: { seat: event.payload.seat, action: { placed: true } },
    };
  }
  return { seq: event.seq, type: event.type, payload: event.payload };
}

export function viewFor(
  game: GameModule<unknown>,
  firstSeat: Seat | null,
  events: Array<{ type: string; payload: { action?: unknown } }>,
  viewer: Seat | "spectator",
): unknown {
  if (firstSeat === null) return null;
  return game.view(fold(game, firstSeat, events), viewer);
}

export async function playTurn(input: {
  store: Store;
  game: GameModule<unknown>;
  matchId: string;
  complete: Completer;
}): Promise<"continue" | "finished"> {
  const match = input.store.getMatch(input.matchId);
  if (!match || match.status !== "active" || match.first_seat === null) return "finished";
  const parsed = input.store.parsedEvents(input.matchId);
  const state = fold(input.game, match.first_seat, parsed);
  const outcome = input.game.outcome(state);
  if (outcome !== "ongoing") {
    finishFromOutcome(input.store, input.matchId, outcome);
    return "finished";
  }
  const seat = input.game.turn(state) as Seat;
  const legal = input.game.legalActions(state, seat);
  const seated = input.store.seats(input.matchId).find((row) => row.seat === seat);
  const snapshot = seated ? JSON.parse(seated.snapshot_json) : {};
  const observation = input.game.view(state, seat);
  const user = [
    `game: ${input.game.id}`,
    `seat: ${seat}`,
    `observation: ${JSON.stringify(observation)}`,
    legal === null ? `placement: ${PLACEMENT_RULE}` : `legal: ${JSON.stringify(legal)}`,
    `coaching: ${JSON.stringify(snapshot)}`,
    "Return one JSON object and no other text.",
  ].join("\n");
  let messages: ChatMessage[] = [
    { role: "system", content: "You choose one legal action for this seat. Obey the coaching snapshot." },
    { role: "user", content: user },
  ];
  let invalid = 0;
  let provider = 0;
  while (true) {
    const result = await input.complete(messages);
    if ("error" in result) {
      provider += 1;
      if (provider >= 2) {
        forfeit(input.store, input.matchId, seat, "model_error");
        return "finished";
      }
      continue;
    }
    const action = parseAction(result.content);
    const verdict = action === null ? "Reply is not a JSON object." : input.game.validate(state, seat, action);
    const listed =
      action !== null &&
      verdict === "ok" &&
      (legal === null || legal.some((candidate) => actionsEqual(candidate, action)));
    if (!listed) {
      invalid += 1;
      const reason = verdict === "ok" ? "Action is not in the legal list." : verdict;
      if (invalid >= 3) {
        forfeit(input.store, input.matchId, seat, "invalid_action");
        return "finished";
      }
      messages = [
        ...messages,
        { role: "assistant", content: result.content },
        { role: "user", content: reason },
      ];
      continue;
    }
    input.store.appendEvent(input.matchId, "action", { seat, action });
    const next = input.game.apply(state, action);
    const nextOutcome = input.game.outcome(next);
    if (nextOutcome !== "ongoing") {
      finishFromOutcome(input.store, input.matchId, nextOutcome);
      return "finished";
    }
    return "continue";
  }
}

function finishFromOutcome(store: Store, matchId: string, outcome: Outcome) {
  if (outcome === "ongoing") return;
  if (outcome === "draw") {
    store.finishMatch({ matchId, result: "draw", winnerSeat: null });
    return;
  }
  store.finishMatch({ matchId, result: "decided", winnerSeat: outcome.winner });
}

function forfeit(store: Store, matchId: string, seat: Seat, cause: "invalid_action" | "model_error") {
  store.finishMatch({
    matchId,
    result: "forfeit",
    winnerSeat: otherSeat(seat),
    forfeitSeat: seat,
    forfeitCause: cause,
  });
}

export function startLoops(input: {
  store: Store;
  gameFor: (id: GameId) => GameModule<unknown>;
  complete: Completer;
  configured: boolean;
  running: Map<string, Promise<void>>;
  afterEvent?: (event: EventRow) => void;
}) {
  if (!input.configured) return;
  for (const id of input.store.activeMatchIds()) ensureLoop({ ...input, matchId: id });
}

export function ensureLoop(input: {
  store: Store;
  gameFor: (id: GameId) => GameModule<unknown>;
  complete: Completer;
  configured: boolean;
  running: Map<string, Promise<void>>;
  matchId: string;
  afterEvent?: (event: EventRow) => void;
}) {
  if (!input.configured) return;
  if (input.running.has(input.matchId)) return;
  const task = (async () => {
    try {
      while (true) {
        const match = input.store.getMatch(input.matchId);
        if (!match || match.status !== "active") return;
        const before = input.store.events(input.matchId).at(-1)?.seq ?? 0;
        const status = await playTurn({
          store: input.store,
          game: input.gameFor(match.game_id),
          matchId: input.matchId,
          complete: input.complete,
        });
        if (input.afterEvent) {
          for (const event of input.store.events(input.matchId)) {
            if (event.seq > before) input.afterEvent(event);
          }
        }
        if (status === "finished") return;
      }
    } catch {
      return;
    }
  })().finally(() => {
    input.running.delete(input.matchId);
  });
  input.running.set(input.matchId, task);
}
