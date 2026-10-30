import { randomBytes, randomInt, randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import type { GameId, Seat } from "../rules/types.js";

export type Coach = {
  id: string;
  email: string;
  password_hash: string;
  display_name: string;
  created_at: string;
};

export type RankingRow = {
  coachId: string;
  displayName: string;
  played: number;
  wins: number;
  losses: number;
  draws: number;
  forfeits: number;
  rank: number;
};

export type AgentRow = {
  coach_id: string;
  persona: string;
  playbook: string;
  context: string;
  updated_at: string;
};

export type MatchRow = {
  id: string;
  game_id: GameId;
  status: "waiting" | "active" | "finished";
  first_seat: Seat | null;
  result: "" | "decided" | "draw" | "forfeit";
  winner_seat: Seat | null;
  forfeit_seat: Seat | null;
  forfeit_cause: "" | "invalid_action" | "model_error";
  created_at: string;
  started_at: string | null;
  ended_at: string | null;
};

export type SeatRow = {
  match_id: string;
  seat: Seat;
  coach_id: string;
  snapshot_json: string;
};

export type EventRow = {
  match_id: string;
  seq: number;
  type: "seated" | "action" | "result";
  payload_json: string;
  created_at: string;
};

export type Snapshot = {
  persona: string;
  playbook: string;
  context: string;
  results: string[];
};

const SCHEMA = `
CREATE TABLE IF NOT EXISTS coaches (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  display_name TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  coach_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS agents (
  coach_id TEXT PRIMARY KEY,
  persona TEXT NOT NULL,
  playbook TEXT NOT NULL,
  context TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS matches (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL,
  status TEXT NOT NULL,
  first_seat INTEGER,
  result TEXT NOT NULL DEFAULT '',
  winner_seat INTEGER,
  forfeit_seat INTEGER,
  forfeit_cause TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  started_at TEXT,
  ended_at TEXT
);
CREATE TABLE IF NOT EXISTS seats (
  match_id TEXT NOT NULL,
  seat INTEGER NOT NULL,
  coach_id TEXT NOT NULL,
  snapshot_json TEXT NOT NULL,
  PRIMARY KEY (match_id, seat)
);
CREATE TABLE IF NOT EXISTS events (
  match_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (match_id, seq)
);
`;

export function openStore(path: string) {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA);
  const now = () => new Date().toISOString();

  const insertCoach = db.prepare(
    `INSERT INTO coaches (id, email, password_hash, display_name, created_at)
     VALUES (@id, @email, @password_hash, @display_name, @created_at)`,
  );
  const insertAgent = db.prepare(
    `INSERT INTO agents (coach_id, persona, playbook, context, updated_at)
     VALUES (?, '', '', '', ?)`,
  );

  function coachById(id: string): Coach | undefined {
    return db.prepare(`SELECT * FROM coaches WHERE id = ?`).get(id) as Coach | undefined;
  }

  function getMatch(id: string): MatchRow | undefined {
    const row = db.prepare(`SELECT * FROM matches WHERE id = ?`).get(id) as MatchRow | undefined;
    return row ? normalizeMatch(row) : undefined;
  }

  function seats(matchId: string): SeatRow[] {
    return db.prepare(`SELECT * FROM seats WHERE match_id = ? ORDER BY seat`).all(matchId) as SeatRow[];
  }

  function events(matchId: string): EventRow[] {
    return db
      .prepare(`SELECT * FROM events WHERE match_id = ? ORDER BY seq`)
      .all(matchId) as EventRow[];
  }

  function nextSeq(matchId: string): number {
    const row = db.prepare(`SELECT MAX(seq) AS seq FROM events WHERE match_id = ?`).get(matchId) as {
      seq: number | null;
    };
    return (row.seq ?? 0) + 1;
  }

  function appendEvent(matchId: string, type: EventRow["type"], payload: unknown): EventRow {
    const row: EventRow = {
      match_id: matchId,
      seq: nextSeq(matchId),
      type,
      payload_json: JSON.stringify(payload),
      created_at: now(),
    };
    db.prepare(
      `INSERT INTO events (match_id, seq, type, payload_json, created_at)
       VALUES (@match_id, @seq, @type, @payload_json, @created_at)`,
    ).run(row);
    return row;
  }

  function resultLines(coachId: string, limit: number): string[] {
    const rows = db
      .prepare(
        `SELECT m.* FROM matches m
         JOIN seats s ON s.match_id = m.id
         WHERE s.coach_id = ? AND m.status = 'finished'
         ORDER BY m.ended_at DESC
         LIMIT ?`,
      )
      .all(coachId, limit) as MatchRow[];
    return rows.map((match) => resultLine(normalizeMatch(match), coachId));
  }

  function resultLine(match: MatchRow, coachId: string): string {
    const seated = seats(match.id);
    const mine = seated.find((seat) => seat.coach_id === coachId);
    const opponent = seated.find((seat) => seat.coach_id !== coachId);
    const opponentName = opponent ? coachById(opponent.coach_id)?.display_name ?? "opponent" : "opponent";
    let word: "win" | "loss" | "draw" = "loss";
    if (match.result === "draw") word = "draw";
    else if (mine && match.winner_seat === mine.seat) word = "win";
    let line = `${match.game_id}, ${opponentName}, ${word}`;
    if (word === "loss" && mine && match.forfeit_seat === mine.seat && match.forfeit_cause) {
      line += ` ${match.forfeit_cause}`;
    }
    return line;
  }

  function snapshotFor(coachId: string): Snapshot {
    const agent = db.prepare(`SELECT * FROM agents WHERE coach_id = ?`).get(coachId) as AgentRow;
    return {
      persona: agent?.persona ?? "",
      playbook: agent?.playbook ?? "",
      context: agent?.context ?? "",
      results: resultLines(coachId, 10),
    };
  }

  const joinTx = db.transaction((matchId: string, coachId: string): { ok: true } | { ok: false; error: string } => {
    const match = getMatch(matchId);
    if (!match) return { ok: false, error: "Match not found." };
    if (match.status !== "waiting") return { ok: false, error: "Match is not open." };
    const seated = seats(matchId);
    if (seated.some((seat) => seat.coach_id === coachId)) return { ok: false, error: "You are already in this match." };
    if (seated.length !== 1) return { ok: false, error: "Match is not open." };
    const firstSeat = randomInt(2) as Seat;
    const stamp = now();
    for (const seat of seated) {
      db.prepare(`UPDATE seats SET snapshot_json = ? WHERE match_id = ? AND seat = ?`).run(
        JSON.stringify(snapshotFor(seat.coach_id)),
        matchId,
        seat.seat,
      );
    }
    const joiner: Snapshot = snapshotFor(coachId);
    db.prepare(
      `INSERT INTO seats (match_id, seat, coach_id, snapshot_json) VALUES (?, 1, ?, ?)`,
    ).run(matchId, coachId, JSON.stringify(joiner));
    db.prepare(
      `UPDATE matches SET status = 'active', first_seat = ?, started_at = ? WHERE id = ?`,
    ).run(firstSeat, stamp, matchId);
    appendEvent(matchId, "seated", {
      seat: 1,
      displayName: coachById(coachId)?.display_name ?? "",
    });
    return { ok: true };
  });

  return {
    db,
    close: () => db.close(),
    createCoach(input: { email: string; displayName: string; passwordHash: string }): Coach {
      const coach: Coach = {
        id: randomUUID(),
        email: input.email.trim().toLowerCase(),
        password_hash: input.passwordHash,
        display_name: input.displayName.trim(),
        created_at: now(),
      };
      insertCoach.run(coach);
      insertAgent.run(coach.id, coach.created_at);
      return coach;
    },
    coachByEmail(email: string): Coach | undefined {
      return db.prepare(`SELECT * FROM coaches WHERE email = ?`).get(email.trim().toLowerCase()) as Coach | undefined;
    },
    coachById,
    createSession(coachId: string): string {
      const id = randomBytes(32).toString("base64url");
      db.prepare(`INSERT INTO sessions (id, coach_id, created_at) VALUES (?, ?, ?)`).run(id, coachId, now());
      return id;
    },
    coachForSession(sessionId: string): Coach | undefined {
      const row = db.prepare(`SELECT coach_id FROM sessions WHERE id = ?`).get(sessionId) as
        | { coach_id: string }
        | undefined;
      return row ? coachById(row.coach_id) : undefined;
    },
    deleteSession(sessionId: string) {
      db.prepare(`DELETE FROM sessions WHERE id = ?`).run(sessionId);
    },
    getAgent(coachId: string): AgentRow {
      return db.prepare(`SELECT * FROM agents WHERE coach_id = ?`).get(coachId) as AgentRow;
    },
    saveAgent(coachId: string, fields: { persona: string; playbook: string; context: string }) {
      db.prepare(
        `UPDATE agents SET persona = ?, playbook = ?, context = ?, updated_at = ? WHERE coach_id = ?`,
      ).run(fields.persona, fields.playbook, fields.context, now(), coachId);
    },
    createMatch(coachId: string, gameId: GameId): MatchRow {
      const id = randomUUID();
      const stamp = now();
      const coach = coachById(coachId);
      db.prepare(
        `INSERT INTO matches (id, game_id, status, result, forfeit_cause, created_at)
         VALUES (?, ?, 'waiting', '', '', ?)`,
      ).run(id, gameId, stamp);
      db.prepare(
        `INSERT INTO seats (match_id, seat, coach_id, snapshot_json) VALUES (?, 0, ?, '{}')`,
      ).run(id, coachId);
      appendEvent(id, "seated", { seat: 0, displayName: coach?.display_name ?? "" });
      return getMatch(id)!;
    },
    getMatch,
    seats,
    events,
    parsedEvents(matchId: string): Array<EventRow & { payload: Record<string, unknown> }> {
      return events(matchId).map((event) => ({
        ...event,
        payload: JSON.parse(event.payload_json) as Record<string, unknown>,
      }));
    },
    joinMatch: joinTx,
    appendEvent,
    snapshotFor,
    finishMatch(input: {
      matchId: string;
      result: "decided" | "draw" | "forfeit";
      winnerSeat: Seat | null;
      forfeitSeat?: Seat;
      forfeitCause?: "invalid_action" | "model_error";
    }): EventRow {
      const write = db.transaction(() => {
        const stamp = now();
        const event = appendEvent(input.matchId, "result", {
          result: input.result,
          winnerSeat: input.winnerSeat,
          forfeitSeat: input.forfeitSeat ?? null,
          forfeitCause: input.forfeitCause ?? "",
        });
        db.prepare(
          `UPDATE matches
           SET status = 'finished', result = ?, winner_seat = ?, forfeit_seat = ?, forfeit_cause = ?, ended_at = ?
           WHERE id = ?`,
        ).run(
          input.result,
          input.winnerSeat,
          input.forfeitSeat ?? null,
          input.forfeitCause ?? "",
          stamp,
          input.matchId,
        );
        return event;
      });
      return write();
    },
    rankings(input: { gameId?: GameId; limit: number; offset: number }): { rows: RankingRow[]; total: number } {
      const from = `FROM matches m
                    JOIN seats s ON s.match_id = m.id
                    JOIN coaches c ON c.id = s.coach_id
                    WHERE m.status = 'finished'${input.gameId === undefined ? "" : " AND m.game_id = @gameId"}`;
      const filter = input.gameId === undefined ? {} : { gameId: input.gameId };
      const read = db.transaction(() => {
        const rows = db.prepare(
          `WITH totals AS (
             SELECT c.id AS coachId, c.display_name AS displayName, COUNT(*) AS played,
                    SUM(CASE WHEN m.winner_seat = s.seat THEN 1 ELSE 0 END) AS wins,
                    SUM(CASE WHEN m.winner_seat <> s.seat THEN 1 ELSE 0 END) AS losses,
                    SUM(CASE WHEN m.result = 'draw' THEN 1 ELSE 0 END) AS draws,
                    SUM(CASE WHEN m.result = 'forfeit' AND m.forfeit_seat = s.seat THEN 1 ELSE 0 END) AS forfeits
             ${from}
             GROUP BY c.id
           ), ranked AS (
             SELECT coachId, displayName, played, wins, losses, draws, forfeits,
                    RANK() OVER (ORDER BY wins DESC, 1.0 * wins / played DESC, played DESC) AS rank
             FROM totals
           )
           SELECT coachId, displayName, played, wins, losses, draws, forfeits, rank
           FROM ranked
           ORDER BY rank, displayName COLLATE NOCASE, coachId
           LIMIT @limit OFFSET @offset`,
        ).all({ ...filter, limit: input.limit, offset: input.offset }) as RankingRow[];
        const { total } = db.prepare(`SELECT COUNT(DISTINCT c.id) AS total ${from}`).get(filter) as { total: number };
        return { rows, total };
      });
      return read();
    },
    record(coachId: string): Array<{ match: MatchRow; line: string; opponent: string }> {
      const rows = db
        .prepare(
          `SELECT m.* FROM matches m
           JOIN seats s ON s.match_id = m.id
           WHERE s.coach_id = ? AND m.status = 'finished'
           ORDER BY m.ended_at DESC`,
        )
        .all(coachId) as MatchRow[];
      return rows.map((row) => {
        const match = normalizeMatch(row);
        const opponentSeat = seats(match.id).find((seat) => seat.coach_id !== coachId);
        return {
          match,
          line: resultLine(match, coachId),
          opponent: opponentSeat ? coachById(opponentSeat.coach_id)?.display_name ?? "" : "",
        };
      });
    },
    activeMatchIds(): string[] {
      return (
        db.prepare(`SELECT id FROM matches WHERE status = 'active'`).all() as Array<{ id: string }>
      ).map((row) => row.id);
    },
  };
}

function normalizeMatch(row: MatchRow): MatchRow {
  return {
    ...row,
    first_seat: row.first_seat === null || row.first_seat === undefined ? null : (Number(row.first_seat) as Seat),
    winner_seat:
      row.winner_seat === null || row.winner_seat === undefined ? null : (Number(row.winner_seat) as Seat),
    forfeit_seat:
      row.forfeit_seat === null || row.forfeit_seat === undefined ? null : (Number(row.forfeit_seat) as Seat),
  };
}

export type Store = ReturnType<typeof openStore>;
