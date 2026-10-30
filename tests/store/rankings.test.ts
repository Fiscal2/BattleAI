import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GameId, Seat } from "../../src/rules/types.ts";
import { openStore, type Coach, type RankingRow, type Store } from "../../src/store/db.ts";

describe("rankings", () => {
  let store: Store;
  let coachNumber: number;

  beforeEach(() => {
    store = openStore(":memory:");
    coachNumber = 0;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    store.close();
  });

  function coach(displayName: string): Coach {
    return store.createCoach({
      email: `coach-${++coachNumber}@example.com`,
      displayName,
      passwordHash: "private-password-hash",
    });
  }

  function match(
    host: Coach,
    guest: Coach,
    input: {
      gameId?: GameId;
      result?: "decided" | "draw" | "forfeit";
      winnerSeat?: Seat;
      forfeitCause?: "invalid_action" | "model_error";
      firstSeat?: Seat;
    } = {},
  ) {
    const created = store.createMatch(host.id, input.gameId ?? "tictactoe");
    expect(store.joinMatch(created.id, guest.id)).toEqual({ ok: true });
    store.db.prepare("UPDATE matches SET first_seat = ? WHERE id = ?").run(input.firstSeat ?? 0, created.id);
    const result = input.result ?? "decided";
    const winnerSeat = input.winnerSeat ?? 0;
    store.finishMatch({
      matchId: created.id,
      result,
      winnerSeat: result === "draw" ? null : winnerSeat,
      ...(result === "forfeit"
        ? { forfeitSeat: (1 - winnerSeat) as Seat, forfeitCause: input.forfeitCause ?? "invalid_action" }
        : {}),
    });
    return created.id;
  }

  function row(person: Coach, stats: Partial<Omit<RankingRow, "coachId" | "displayName">> = {}): RankingRow {
    return {
      coachId: person.id,
      displayName: person.display_name,
      played: 1,
      wins: 0,
      losses: 0,
      draws: 0,
      forfeits: 0,
      rank: 1,
      ...stats,
    };
  }

  it("returns an empty result and excludes coaches with only waiting or active matches", () => {
    expect(store.rankings({ limit: 50, offset: 0 })).toEqual({ rows: [], total: 0 });
    const idle = coach("Idle");
    const waiting = coach("Waiting");
    const active = coach("Active");
    store.createMatch(waiting.id, "four");
    const ongoing = store.createMatch(active.id, "fleet");
    expect(store.joinMatch(ongoing.id, idle.id)).toEqual({ ok: true });

    expect(store.rankings({ limit: 50, offset: 0 })).toEqual({ rows: [], total: 0 });
    expect(store.rankings({ gameId: "fleet", limit: 50, offset: 0 })).toEqual({ rows: [], total: 0 });
  });

  it("aggregates finished wins, losses, draws and both forfeit causes across games", () => {
    const ada = coach("Ada");
    const bea = coach("Bea");
    const cy = coach("Cy");
    coach("Never played");
    match(ada, bea, { firstSeat: 1 });
    match(bea, ada, { gameId: "four", result: "forfeit", forfeitCause: "invalid_action" });
    match(ada, cy, { gameId: "fleet", result: "forfeit", winnerSeat: 1, forfeitCause: "model_error" });
    match(bea, cy, { gameId: "checkers", result: "draw", firstSeat: 1 });
    store.createMatch(ada.id, "tictactoe");
    const active = store.createMatch(cy.id, "four");
    store.joinMatch(active.id, ada.id);

    expect(store.rankings({ limit: 50, offset: 0 })).toEqual({
      rows: [
        row(cy, { played: 2, wins: 1, draws: 1 }),
        row(ada, { played: 3, wins: 1, losses: 2, forfeits: 2, rank: 2 }),
        row(bea, { played: 3, wins: 1, losses: 1, draws: 1, rank: 2 }),
      ],
      total: 3,
    });
  });

  it.each([
    ["invalid_action", 0],
    ["invalid_action", 1],
    ["model_error", 0],
    ["model_error", 1],
  ] as const)("counts %s forfeits with winning seat %i, independently of the first seat", (forfeitCause, winnerSeat) => {
    const host = coach("Host");
    const guest = coach("Guest");
    match(host, guest, { result: "forfeit", forfeitCause, winnerSeat, firstSeat: (1 - winnerSeat) as Seat });
    const winner = winnerSeat === 0 ? host : guest;
    const loser = winnerSeat === 0 ? guest : host;

    expect(store.rankings({ limit: 50, offset: 0 })).toEqual({
      rows: [row(winner, { wins: 1 }), row(loser, { losses: 1, forfeits: 1, rank: 2 })],
      total: 2,
    });
  });

  it.each([0, 1] as const)("counts draws for both seats with first seat %i", (firstSeat) => {
    const ada = coach("Ada");
    const bea = coach("Bea");
    match(ada, bea, { result: "draw", firstSeat });
    match(bea, ada, { result: "draw", firstSeat });

    expect(store.rankings({ limit: 50, offset: 0 })).toEqual({
      rows: [row(ada, { played: 2, draws: 2 }), row(bea, { played: 2, draws: 2 })],
      total: 2,
    });
  });

  it("sorts by wins, then fractional win rate including draws, then matches played", () => {
    const opponent = coach("Opponent");
    const mostWins = coach("Most wins");
    const bestRate = coach("Best rate");
    const lowerRate = coach("Lower rate");
    const mostPlayed = coach("Most played");
    const leastPlayed = coach("Least played");
    for (let i = 0; i < 3; i++) match(mostWins, opponent);
    for (let i = 0; i < 7; i++) match(mostWins, opponent, { result: "draw" });
    for (let i = 0; i < 2; i++) match(bestRate, opponent);
    for (let i = 0; i < 2; i++) match(lowerRate, opponent);
    match(lowerRate, opponent, { result: "draw" });
    for (let i = 0; i < 2; i++) match(mostPlayed, opponent, { result: "draw" });
    match(leastPlayed, opponent, { result: "draw" });

    expect(store.rankings({ limit: 50, offset: 0 }).rows).toEqual([
      row(mostWins, { played: 10, wins: 3, draws: 7 }),
      row(bestRate, { played: 2, wins: 2, rank: 2 }),
      row(lowerRate, { played: 3, wins: 2, draws: 1, rank: 3 }),
      row(opponent, { played: 18, losses: 7, draws: 11, rank: 4 }),
      row(mostPlayed, { played: 2, draws: 2, rank: 5 }),
      row(leastPlayed, { draws: 1, rank: 6 }),
    ]);
  });

  it("compares win rates without rounding", () => {
    const opponent = coach("Opponent");
    const higherRate = coach("Higher rate");
    const lowerRate = coach("Lower rate");
    match(higherRate, opponent);
    match(lowerRate, opponent);
    for (let i = 0; i < 98; i++) match(higherRate, opponent, { result: "draw" });
    for (let i = 0; i < 99; i++) match(lowerRate, opponent, { result: "draw" });

    // Both rates round to 0.01; the coach with 1/99 must lead the coach with 1/100.
    expect(store.rankings({ limit: 50, offset: 0 }).rows).toEqual([
      row(higherRate, { played: 99, wins: 1, draws: 98 }),
      row(lowerRate, { played: 100, wins: 1, draws: 99, rank: 2 }),
      row(opponent, { played: 199, losses: 2, draws: 197, rank: 3 }),
    ]);
  });

  it("keeps duplicate and case-equivalent names separate with competition ranks stable across pages", () => {
    const opponent = coach("Opponent");
    const tied = [coach("same"), coach("Same"), coach("same")];
    const laterName = coach("Zulu");
    const sorted = [...tied].sort((a, b) => a.id < b.id ? -1 : 1);
    for (const person of [...tied, laterName]) match(person, opponent);
    const expected = [
      ...sorted.map((person) => row(person, { wins: 1 })),
      row(laterName, { wins: 1 }),
      row(opponent, { played: 4, losses: 4, rank: 5 }),
    ];

    expect(store.rankings({ limit: 50, offset: 0 })).toEqual({ rows: expected, total: 5 });
    for (let offset = 0; offset < expected.length; offset++) {
      expect(store.rankings({ limit: 1, offset })).toEqual({ rows: expected.slice(offset, offset + 1), total: 5 });
      expect(store.rankings({ gameId: "tictactoe", limit: 1, offset })).toEqual({
        rows: expected.slice(offset, offset + 1),
        total: 5,
      });
    }
    expect(store.rankings({ limit: 50, offset: 5 })).toEqual({ rows: [], total: 5 });
    expect(store.rankings({ limit: 50, offset: 100 })).toEqual({ rows: [], total: 5 });
    expect(store.rankings({ limit: 0, offset: 0 })).toEqual({ rows: [], total: 5 });
  });

  it("filters the population and recomputes ranks before pagination for exactly one game", () => {
    const ada = coach("Ada");
    const bea = coach("Bea");
    const cy = coach("Cy");
    match(ada, cy);
    match(ada, cy);
    match(bea, ada, { gameId: "four", result: "forfeit", forfeitCause: "model_error" });
    match(ada, bea, { gameId: "four", result: "draw" });
    match(bea, cy, { gameId: "checkers", winnerSeat: 1 });

    expect(store.rankings({ limit: 50, offset: 0 }).rows.map(({ coachId, rank }) => ({ coachId, rank }))).toEqual([
      { coachId: ada.id, rank: 1 },
      { coachId: bea.id, rank: 2 },
      { coachId: cy.id, rank: 2 },
    ]);
    expect(store.rankings({ gameId: "four", limit: 1, offset: 0 })).toEqual({
      rows: [row(bea, { played: 2, wins: 1, draws: 1 })],
      total: 2,
    });
    expect(store.rankings({ gameId: "four", limit: 1, offset: 1 })).toEqual({
      rows: [row(ada, { played: 2, losses: 1, draws: 1, forfeits: 1, rank: 2 })],
      total: 2,
    });
    expect(store.rankings({ gameId: "four", limit: 1, offset: 2 })).toEqual({ rows: [], total: 2 });
    expect(store.rankings({ gameId: "checkers", limit: 50, offset: 0 })).toEqual({
      rows: [row(cy, { wins: 1 }), row(bea, { losses: 1, rank: 2 })],
      total: 2,
    });
    expect(store.rankings({ gameId: "fleet", limit: 50, offset: 0 })).toEqual({ rows: [], total: 0 });
  });

  it("keeps a tie across rows 50–51 and skips the following rank without per-coach reads or leaking private data", () => {
    const opponent = coach("Opponent");
    const winners = Array.from({ length: 51 }, (_, i) => coach(`Winner ${String(i).padStart(2, "0")}`));
    for (const [index, person] of winners.entries()) {
      match(person, opponent);
      if (index < 49) match(person, opponent);
    }
    const expected = winners.map((person, index) => row(person, index < 49
      ? { played: 2, wins: 2 }
      : { wins: 1, rank: 50 }));
    store.saveAgent(winners[0].id, { persona: "private persona", playbook: "private playbook", context: "private context" });
    store.createSession(winners[0].id);
    const prepare = vi.spyOn(store.db, "prepare");

    const first = store.rankings({ limit: 50, offset: 0 });
    expect(prepare.mock.calls.length).toBeLessThanOrEqual(2);
    expect(first).toEqual({ rows: expected.slice(0, 50), total: 52 });
    expect(store.rankings({ limit: 50, offset: 50 })).toEqual({
      rows: [...expected.slice(50), row(opponent, { played: 100, losses: 100, rank: 52 })],
      total: 52,
    });
    expect(Object.keys(first.rows[0]).sort()).toEqual([
      "coachId", "displayName", "draws", "forfeits", "losses", "played", "rank", "wins",
    ]);
  });
});
