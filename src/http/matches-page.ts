import type { GameId } from "../rules/types.js";
import type { CoachMatch } from "../store/db.js";
import { gameGraphic } from "./graphics.js";
import { escapeHtml } from "./page.js";

export function matchesBody(rows: CoachMatch[], labels: Record<GameId, string>): string {
  const groups: Array<{ status: CoachMatch["status"]; title: string; empty: string }> = [
    { status: "active", title: "Active matches", empty: "No matches in progress. Invite a coach to a waiting match or create a new match below." },
    { status: "waiting", title: "Waiting for opponent", empty: "No open invitations. Choose a game below to create a match and invite a coach." },
    { status: "finished", title: "Completed matches", empty: "No finished matches yet. Completed matches and their replays will appear here." },
  ];
  const sections = groups.map(({ status, title, empty }) => {
    const matches = rows.filter(row => row.status === status);
    const list = matches.map(row => {
      const action = status === "active" ? "Resume" : status === "waiting" ? "Share invitation" : "View replay";
      const state = status === "active" ? "In progress" : status === "waiting" ? "Waiting for opponent" : resultLabel(row);
      const opponent = row.opponentName === null ? "Open seat" : `vs ${row.opponentName}`;
      return `<a class="record" href="/matches/${escapeHtml(encodeURIComponent(row.id))}"><span>${escapeHtml(labels[row.gameId])}</span><span>${escapeHtml(opponent)}</span><span>${escapeHtml(state)} · ${action}</span></a>`;
    }).join("");
    return `<section class="records-section" aria-labelledby="matches-${status}"><div class="section-heading"><h2 class="section-title" id="matches-${status}">${title}</h2><span class="count-badge">${matches.length}</span></div>
      <div class="records">${list || `<div class="empty-record"><p class="body">${empty}</p></div>`}</div></section>`;
  }).join("");

  return `<div class="page-heading"><h1 class="page-title">Matches</h1><p class="body">Resume a match, share an invitation, or revisit a replay.</p></div>
    ${rows.length === 0 ? '<a class="pill pill-ghost" href="#create-match">Create your first match</a>' : '<a class="pill pill-primary" href="#create-match">New match</a>'}
    ${sections}
    <section class="records-section" aria-label="Create a match">
      <form class="panel match-create" id="create-match" method="post" action="/matches">
        <fieldset class="game-picker"><legend class="section-title">Choose your arena</legend>
          ${(Object.keys(labels) as GameId[]).map((gameId, index) => `<label class="game-option"><input type="radio" name="gameId" value="${escapeHtml(gameId)}"${index === 0 ? " checked" : ""}><span class="game-choice">${gameGraphic(gameId)}<span class="game-name">${escapeHtml(labels[gameId])}</span><span class="game-description">${gameId === "fleet" ? "Hidden fleets · 10 × 10" : gameId === "checkers" ? "English draughts · 8 × 8" : gameId === "four" ? "Gravity · 7 × 6" : "Three in a line · 3 × 3"}</span><span class="choice-indicator" aria-hidden="true"></span></span></label>`).join("")}
        </fieldset>
        <div class="form-footer"><p class="body">Share the match link with your opponent.</p><button class="pill pill-primary" type="submit">Create match <span aria-hidden="true">→</span></button></div>
      </form>
    </section>`;
}

function resultLabel(row: CoachMatch): string {
  if (row.result === "draw") return "Draw";
  const won = row.winnerSeat === row.mySeat;
  if (row.result !== "forfeit") return won ? "Won" : "Lost";
  if (won) return "Won by forfeit";
  const cause = row.forfeitCause === "invalid_action" ? "invalid action" : row.forfeitCause === "model_error" ? "model error" : "";
  return `Lost by forfeit${cause && row.forfeitSeat === row.mySeat ? ` (${cause})` : ""}`;
}
