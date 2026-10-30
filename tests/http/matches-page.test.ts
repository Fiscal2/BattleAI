import { describe, expect, it } from "vitest";
import { matchesBody } from "../../src/http/matches-page.ts";
import { openStore, type CoachMatch } from "../../src/store/db.ts";
import type { GameId } from "../../src/rules/types.ts";

const labels: Record<GameId, string> = {
  tictactoe: "Tic-tac-toe", four: "Four in a Row", checkers: "Checkers", fleet: "Fleet",
};

function row(input: Partial<CoachMatch> = {}): CoachMatch {
  return {
    id: "match-id", gameId: "four", status: "active", result: "", winnerSeat: null,
    forfeitSeat: null, forfeitCause: "", mySeat: 0, opponentName: "Ada",
    createdAt: "2026-10-29T00:00:00.000Z", startedAt: null, endedAt: null, ...input,
  };
}

function records(html: string): string[] {
  return [...html.matchAll(/<a class="record"[^>]*>[\s\S]*?<\/a>/g)].map(match => match[0]);
}

describe("matches page body", () => {
  it("groups every match with counts, opponent, status and explicit resume/invitation/replay links", () => {
    const html = matchesBody([
      row({ id: "finished", status: "finished", result: "draw", gameId: "checkers" }),
      row({ id: "waiting", status: "waiting", opponentName: null, gameId: "fleet" }),
      row({ id: "active-first", opponentName: "Ada, the coach" }),
      row({ id: "active-second", mySeat: 1, gameId: "tictactoe" }),
    ], labels);
    expect(html).toContain('<h1 class="page-title">Matches</h1>');
    const newMatchLink = '<a class="pill pill-primary" href="#create-match">New match</a>';
    expect(html).toContain(newMatchLink);
    expect(html.indexOf(newMatchLink)).toBeLessThan(html.indexOf('aria-labelledby="matches-active"'));
    expect(html).toContain('id="create-match"');
    const groups = [...html.matchAll(/<section class="records-section" aria-labelledby="matches-(\w+)">([\s\S]*?)<\/section>/g)];
    expect(groups.map(group => group[1])).toEqual(["active", "waiting", "finished"]);
    for (const [index, title] of ["Active matches", "Waiting for opponent", "Completed matches"].entries()) {
      expect(groups[index][2]).toContain(`>${title}</h2><span class="count-badge">${index === 0 ? 2 : 1}</span>`);
    }
    const links = records(html);
    expect(links).toHaveLength(4);
    expect(links.map(link => link.match(/href="([^"]+)"/)?.[1])).toEqual([
      "/matches/active-first", "/matches/active-second", "/matches/waiting", "/matches/finished",
    ]);
    expect(links[0]).toContain("Four in a Row");
    expect(links[0]).toContain("vs Ada, the coach");
    expect(links[0]).toContain("In progress · Resume");
    expect(links[2]).toContain("Open seat");
    expect(links[2]).toContain("Waiting for opponent · Share invitation");
    expect(links[3]).toContain("Draw · View replay");
    expect(html).not.toMatch(/pagination|Apply filter|<script|onclick=/);
  });

  it("shows all empty group counts and a useful link to the working game picker/create form", () => {
    const html = matchesBody([], labels);
    expect(html.match(/class="count-badge">0<\/span>/g)).toHaveLength(3);
    expect(html).toContain("No matches in progress");
    expect(html).toContain("No open invitations");
    expect(html).toContain("No finished matches yet");
    expect(html).toContain("Completed matches and their replays will appear here");
    expect(html).toContain('href="#create-match">Create your first match</a>');
    expect(html).not.toContain('>New match</a>');
    expect(html).toContain('<form class="panel match-create" id="create-match" method="post" action="/matches">');
    expect(html).toContain('<fieldset class="game-picker"><legend class="section-title">Choose your arena</legend>');
    const radios = [...html.matchAll(/<input type="radio" name="gameId" value="([^"]+)"([^>]*)>/g)];
    expect(radios.map(radio => radio[1])).toEqual(Object.keys(labels));
    expect(radios.filter(radio => radio[2].includes("checked")).map(radio => radio[1])).toEqual(["tictactoe"]);
    expect(html).toContain('type="submit">Create match');
    expect(html).not.toMatch(/<!doctype|<html\b|<script\b/);
    expect(records(html)).toEqual([]);
  });

  it.each([0, 1] as const)("labels results from my seat %i, without parsing opponent names", (mySeat) => {
    const opposite = mySeat === 0 ? 1 : 0;
    const cases: Array<[Partial<CoachMatch>, string]> = [
      [{ result: "decided", winnerSeat: mySeat }, "Won"],
      [{ result: "decided", winnerSeat: opposite }, "Lost"],
      [{ result: "draw" }, "Draw"],
      [{ result: "forfeit", winnerSeat: mySeat, forfeitSeat: opposite, forfeitCause: "invalid_action" }, "Won by forfeit"],
      [{ result: "forfeit", winnerSeat: mySeat, forfeitSeat: opposite, forfeitCause: "model_error" }, "Won by forfeit"],
      [{ result: "forfeit", winnerSeat: opposite, forfeitSeat: mySeat, forfeitCause: "invalid_action" }, "Lost by forfeit (invalid action)"],
      [{ result: "forfeit", winnerSeat: opposite, forfeitSeat: mySeat, forfeitCause: "model_error" }, "Lost by forfeit (model error)"],
    ];
    for (const [metadata, expected] of cases) {
      const html = matchesBody([row({ status: "finished", mySeat, opponentName: "Name, win, loss", ...metadata })], labels);
      expect(records(html)[0]).toContain(`${expected} · View replay`);
      expect(records(html)[0]).toContain("vs Name, win, loss");
    }
  });

  it("escapes opponent names, game labels and match URL components", () => {
    const injected = '<script>alert("x" & \'y\')</script>';
    const html = matchesBody([row({ id: '../" onmouseover="attack?x=#', opponentName: injected })], {
      ...labels, four: injected,
    });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;alert(&quot;x&quot; &amp; &#39;y&#39;)&lt;/script&gt;");
    expect(records(html)[0]).toContain('href="/matches/..%2F%22%20onmouseover%3D%22attack%3Fx%3D%23"');
    expect(html).not.toMatch(/\sonmouseover=/);
    expect(html).not.toContain(injected);
    expect(html).not.toContain("&amp;lt;script");
  });

  it("renders the store projection through waiting, joined and finished states without unrelated or private content", () => {
    const store = openStore(":memory:");
    try {
      const host = store.createCoach({ email: "host@private.local", displayName: "Host", passwordHash: "private hash" });
      const guest = store.createCoach({ email: "guest@private.local", displayName: "Guest", passwordHash: "private hash" });
      store.saveAgent(host.id, { persona: "private persona", playbook: "private playbook", context: "private context" });
      const mine = store.createMatch(host.id, "tictactoe");
      const unrelated = store.createMatch(guest.id, "fleet");
      const waiting = matchesBody(store.coachMatches(host.id), labels);
      expect(records(waiting)).toHaveLength(1);
      expect(waiting).toContain(`/matches/${mine.id}`);
      expect(waiting).toContain("Open seat");
      expect(waiting).not.toContain(unrelated.id);
      expect(store.joinMatch(mine.id, guest.id)).toEqual({ ok: true });
      const active = matchesBody(store.coachMatches(guest.id), labels);
      expect(active).toContain("vs Host");
      expect(active).toContain("In progress · Resume");
      store.finishMatch({ matchId: mine.id, result: "forfeit", winnerSeat: 1, forfeitSeat: 0, forfeitCause: "model_error" });
      const finished = matchesBody(store.coachMatches(host.id), labels);
      expect(finished).toContain("Lost by forfeit (model error) · View replay");
      expect(finished).not.toMatch(/private|password|persona|playbook|snapshot|host@/);
      expect(store.record(host.id)[0].line).toBe("tictactoe, Guest, loss model_error");
    } finally {
      store.close();
    }
  });
});
