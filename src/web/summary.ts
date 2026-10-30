import { resultText } from "./feed.js";
import { agentName, isSeat, type MatchResult, type ShownEvent } from "./types.js";

export function summaryTotals(game: string, events: ShownEvent[]) {
  const totals = ([0, 1] as const).map(seat => ({ seat, moves: 0, captures: 0, promotions: 0, shots: 0, hits: 0, misses: 0, sunk: 0 }));
  for (const event of events) {
    if (event.type !== "action" || !isSeat(event.payload.seat)) continue;
    const total = totals[event.payload.seat];
    total.moves++;
    const effect = event.consequence;
    if (game === "checkers") {
      total.captures += effect?.captured ?? 0;
      if (effect?.promoted) total.promotions++;
    } else if (game === "fleet") {
      const action = event.payload.action as { cell?: unknown } | undefined;
      if (typeof action?.cell === "string") total.shots++;
      if (effect?.hit === true) total.hits++;
      if (effect?.hit === false) total.misses++;
      if (effect?.sunkLength) total.sunk++;
    }
  }
  return totals;
}

export function renderSummary(document: Document, game: string, events: ShownEvent[], result: MatchResult | null, names: Record<string, string>) {
  const panel = document.querySelector<HTMLElement>("#match-summary");
  const content = document.querySelector<HTMLElement>("#summary-content");
  if (!panel || !content) return;
  panel.hidden = result === null;
  if (!result) return;
  const description = resultText(result, names);
  const outcome = document.createElement("p");
  outcome.className = "summary-result";
  outcome.textContent = [description.title, description.detail].filter(Boolean).join(". ");
  const list = document.createElement("dl");
  list.className = "summary-records";
  const count = (amount: number, singular: string, plural = `${singular}s`) => `${amount} ${amount === 1 ? singular : plural}`;
  for (const total of summaryTotals(game, events)) {
    const row = document.createElement("div");
    const name = document.createElement("dt");
    name.textContent = agentName(names, total.seat);
    const stats = document.createElement("dd");
    stats.textContent = game === "fleet"
      ? `${count(total.shots, "shot")} · ${count(total.hits, "hit")} · ${count(total.misses, "miss", "misses")} · ${count(total.sunk, "ship")} sunk`
      : `${count(total.moves, "recorded move")}${game === "checkers" ? ` · ${count(total.captures, "piece")} captured · ${count(total.promotions, "promotion")}` : ""}`;
    row.append(name, stats);
    list.append(row);
  }
  content.replaceChildren(outcome, list);
}
