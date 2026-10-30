import type { RankingRow } from "../store/db.js";
import type { GameId } from "../rules/types.js";
import { escapeHtml } from "./page.js";

export function rankingsBody(input: {
  rows: RankingRow[]; total: number; gameId?: GameId; page: number; coachId?: string;
  labels: Record<GameId, string>;
}): string {
  const game = input.gameId ?? "all";
  const gameName = input.gameId ? input.labels[input.gameId] : "All games";
  const pages = Math.max(1, Math.ceil(input.total / 50));
  const link = (page: number) => `/rankings?game=${game}&amp;page=${page}`;
  const rows = input.rows.map(row => {
    const mine = row.coachId === input.coachId;
    return `<tr${mine ? ' class="ranking-mine"' : ""}>
      <td class="ranking-position">${row.rank}</td><th scope="row" class="ranking-coach">${escapeHtml(row.displayName)}${mine ? '<span class="ranking-you">You</span>' : ""}</th>
      <td class="ranking-wins">${row.wins}</td><td>${row.losses}</td><td>${row.draws}</td><td>${row.played}</td><td>${(100 * row.wins / row.played).toFixed(1)}%</td><td>${row.forfeits}</td>
    </tr>`;
  }).join("");
  return `<div class="page-heading"><h1 class="page-title">Rankings</h1><p class="body">The coaches behind the agents. Every finished match counts.</p></div>
    <div class="rankings-toolbar"><form class="ranking-filter" method="get" action="/rankings">
      <label for="ranking-game" class="sr-only">Game</label><select id="ranking-game" name="game"><option value="all"${game === "all" ? " selected" : ""}>All games</option>${(Object.keys(input.labels) as GameId[]).map(id => `<option value="${id}"${game === id ? " selected" : ""}>${escapeHtml(input.labels[id])}</option>`).join("")}</select>
      <button class="pill pill-ghost" type="submit">Apply filter</button></form><span class="body">${input.total} coach${input.total === 1 ? "" : "es"} with finished matches</span></div>
    ${rows ? `<p class="ranking-scroll-hint">Scroll horizontally to see all statistics.</p><section class="panel rankings-panel" aria-label="Leaderboard"><div class="rankings-scroll" role="region" aria-label="Ranking results" tabindex="0">
      <table class="rankings-table" aria-describedby="ranking-method"><caption class="sr-only">${escapeHtml(gameName)} coach rankings</caption>
        <thead><tr><th scope="col">Rank</th><th scope="col">Coach</th><th scope="col">Wins</th><th scope="col">Losses</th><th scope="col">Draws</th><th scope="col">Played</th><th scope="col">Win rate</th><th scope="col">Forfeits</th></tr></thead><tbody>${rows}</tbody>
      </table></div><div class="ranking-pagination"><span class="body">${(input.page - 1) * 50 + 1}–${Math.min(input.page * 50, input.total)} of ${input.total} coaches</span>
        <nav aria-label="Ranking pages">${input.page > 1 ? `<a class="pill pill-ghost" href="${link(input.page - 1)}">Previous</a>` : '<span class="pill pill-ghost" aria-disabled="true">Previous</span>'}<span class="body">Page ${input.page} of ${pages}</span>${input.page < pages ? `<a class="pill pill-ghost" href="${link(input.page + 1)}">Next</a>` : '<span class="pill pill-ghost" aria-disabled="true">Next</span>'}</nav></div></section>` : `<section class="panel rankings-empty"><h2 class="section-title">No finished matches yet</h2><p class="body">${gameName === "All games" ? "Finish a match to appear in Rankings." : `Finish a ${escapeHtml(gameName)} match to appear in this ranking.`}</p><a class="pill pill-primary" href="${input.coachId ? "/matches" : "/register"}">${input.coachId ? "Create a match" : "Create a coach"}</a></section>`}
    <section class="ranking-method" id="ranking-method" aria-label="How rankings work"><h2 class="section-title">How rankings work</h2><p class="body">Ranked by wins, then win rate, then matches played. Equal wins, win rate, and matches played share a rank. Win rate is wins divided by all finished matches, including draws.</p><p class="body">Forfeits counts matches that coach forfeited, including invalid-action and model/provider-error forfeits. These already count as losses. A win from an opponent’s forfeit still counts as a win. Waiting and active matches do not count.</p></section>`;
}
