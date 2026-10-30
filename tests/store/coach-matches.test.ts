import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openStore, type Coach, type Store } from "../../src/store/db.ts";
import type { Seat } from "../../src/rules/types.ts";

describe("coach match discovery", () => {
  let store: Store;
  let number: number;

  beforeEach(() => {
    store = openStore(":memory:");
    number = 0;
  });
  afterEach(() => {
    vi.restoreAllMocks();
    store.close();
  });

  function coach(displayName: string): Coach {
    return store.createCoach({ email: `${++number}@private.local`, displayName, passwordHash: "private hash" });
  }

  function active(host: Coach, guest: Coach) {
    const match = store.createMatch(host.id, "four");
    expect(store.joinMatch(match.id, guest.id)).toEqual({ ok: true });
    return match.id;
  }

  it("returns only the coach's waiting, active and finished matches in both seat roles", () => {
    const me = coach("Me");
    const other = coach("Other");
    const unrelated = coach("Unrelated");
    const waiting = store.createMatch(me.id, "fleet");
    const hosted = active(me, other);
    const joined = active(other, me);
    const finished = active(other, me);
    store.finishMatch({ matchId: finished, result: "decided", winnerSeat: 1 });
    store.createMatch(unrelated.id, "checkers");
    active(other, unrelated);
    const privateFinished = active(other, unrelated);
    store.finishMatch({ matchId: privateFinished, result: "draw", winnerSeat: null });
    const unsupported = store.createMatch(me.id, "tictactoe");
    store.db.prepare("UPDATE matches SET status = 'cancelled' WHERE id = ?").run(unsupported.id);

    const rows = store.coachMatches(me.id);
    expect(rows).toHaveLength(4);
    expect(rows.find(row => row.id === waiting.id)).toEqual({
      id: waiting.id, gameId: "fleet", status: "waiting", result: "",
      winnerSeat: null, forfeitSeat: null, forfeitCause: "", mySeat: 0, opponentName: null,
      createdAt: waiting.created_at, startedAt: null, endedAt: null,
    });
    expect(rows.find(row => row.id === hosted)).toMatchObject({ status: "active", mySeat: 0, opponentName: "Other" });
    expect(rows.find(row => row.id === joined)).toMatchObject({ status: "active", mySeat: 1, opponentName: "Other" });
    expect(rows.find(row => row.id === finished)).toMatchObject({ status: "finished", mySeat: 1, winnerSeat: 1 });
    expect(store.coachMatches("unknown")).toEqual([]);
    expect(store.coachMatches("' OR 1=1 --")).toEqual([]);
  });

  it("sorts active, waiting, finished by recent state activity, then descending ID for ties", () => {
    const me = coach("Me");
    const other = coach("Other");
    const early = "2026-01-01T00:00:00.000Z";
    const later = "2026-02-01T00:00:00.000Z";
    const newest = "2026-03-01T00:00:00.000Z";
    const activeOld = active(me, other);
    const activeNew = [active(other, me), active(me, other)];
    const waitingOld = store.createMatch(me.id, "fleet").id;
    const waitingNew = [store.createMatch(me.id, "fleet").id, store.createMatch(me.id, "fleet").id];
    const finishedOld = active(me, other);
    const finishedNew = [active(me, other), active(other, me)];
    for (const id of [finishedOld, ...finishedNew]) store.finishMatch({ matchId: id, result: "draw", winnerSeat: null });
    for (const id of [activeOld, ...activeNew]) {
      store.db.prepare("UPDATE matches SET created_at = ?, started_at = ? WHERE id = ?")
        .run(newest, id === activeOld ? early : later, id);
    }
    for (const id of [waitingOld, ...waitingNew]) {
      store.db.prepare("UPDATE matches SET created_at = ? WHERE id = ?").run(id === waitingOld ? later : newest, id);
    }
    for (const id of [finishedOld, ...finishedNew]) {
      store.db.prepare("UPDATE matches SET created_at = ?, started_at = ?, ended_at = ? WHERE id = ?")
        .run(early, early, id === finishedOld ? later : newest, id);
    }
    const expected = [
      ...activeNew.sort().reverse(), activeOld,
      ...waitingNew.sort().reverse(), waitingOld,
      ...finishedNew.sort().reverse(), finishedOld,
    ];
    expect(store.coachMatches(me.id).map(row => row.id)).toEqual(expected);
    expect(store.coachMatches(me.id).map(row => row.id)).toEqual(expected);
  });

  it.each([
    ["decided", 0, ""], ["decided", 1, ""],
    ["forfeit", 0, "invalid_action"], ["forfeit", 1, "invalid_action"],
    ["forfeit", 0, "model_error"], ["forfeit", 1, "model_error"],
  ] as const)("returns %s metadata for winner seat %i and cause %s to both participants", (result, winnerSeat, cause) => {
    const host = coach("Host, with comma");
    const guest = coach("Guest");
    const id = active(host, guest);
    store.db.prepare("UPDATE matches SET first_seat = ? WHERE id = ?").run(1 - winnerSeat, id);
    const forfeitSeat = (1 - winnerSeat) as Seat;
    store.finishMatch({ matchId: id, result, winnerSeat,
      ...(cause ? { forfeitSeat, forfeitCause: cause } : {}),
    });
    for (const [mySeat, person, opponentName] of [[0, host, "Guest"], [1, guest, "Host, with comma"]] as const) {
      expect(store.coachMatches(person.id)).toEqual([expect.objectContaining({
        id, status: "finished", result, winnerSeat, mySeat, opponentName,
        forfeitSeat: cause ? forfeitSeat : null, forfeitCause: cause,
        endedAt: expect.any(String),
      })]);
    }
  });

  it("preserves finished record lines, coaching results and rankings when discovery includes unfinished matches", () => {
    const host = coach("Host");
    const guest = coach("Guest");
    const forfeited = active(host, guest);
    store.finishMatch({ matchId: forfeited, result: "forfeit", winnerSeat: 1, forfeitSeat: 0, forfeitCause: "model_error" });
    const drawn = active(guest, host);
    store.finishMatch({ matchId: drawn, result: "draw", winnerSeat: null });
    active(host, guest);
    store.createMatch(host.id, "fleet");
    const records = [store.record(host.id), store.record(guest.id)];
    const snapshots = [store.snapshotFor(host.id), store.snapshotFor(guest.id)];
    const rankings = store.rankings({ limit: 50, offset: 0 });

    expect(store.coachMatches(host.id).find(row => row.id === drawn)).toMatchObject({ result: "draw", winnerSeat: null, mySeat: 1 });
    expect(store.coachMatches(guest.id).find(row => row.id === drawn)).toMatchObject({ result: "draw", winnerSeat: null, mySeat: 0 });
    expect(store.record(host.id)).toEqual(records[0]);
    expect(store.record(guest.id)).toEqual(records[1]);
    expect(records[0].map(row => row.line)).toContain("four, Guest, loss model_error");
    expect(records[1].map(row => row.line)).toContain("four, Host, win");
    expect(records[0]).toHaveLength(2);
    expect(store.snapshotFor(host.id)).toEqual(snapshots[0]);
    expect(store.snapshotFor(guest.id)).toEqual(snapshots[1]);
    expect(store.rankings({ limit: 50, offset: 0 })).toEqual(rankings);
  });

  it("reads all history with one joined query and excludes private account and coaching fields", () => {
    const me = coach("Me");
    const other = coach("Other");
    store.saveAgent(me.id, { persona: "private persona", playbook: "private playbook", context: "private context" });
    store.saveAgent(other.id, { persona: "opponent persona", playbook: "opponent playbook", context: "opponent context" });
    for (let i = 0; i < 55; i++) active(i % 2 ? me : other, i % 2 ? other : me);
    const prepare = vi.spyOn(store.db, "prepare");
    const rows = store.coachMatches(me.id);
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(prepare.mock.calls[0][0]).toMatch(/JOIN seats mine[\s\S]*LEFT JOIN seats other[\s\S]*LEFT JOIN coaches opponent/);
    expect(rows).toHaveLength(55);
    expect(Object.keys(rows[0]).sort()).toEqual([
      "createdAt", "endedAt", "forfeitCause", "forfeitSeat", "gameId", "id", "mySeat", "opponentName", "result", "startedAt", "status", "winnerSeat",
    ]);
    expect(JSON.stringify(rows)).not.toMatch(/private|password|persona|playbook|snapshot|coachId|email|opponent context/);
  });
});
