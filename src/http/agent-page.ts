import { escapeHtml } from "./page.js";

export function agentEditor(
  agent: { persona: string; playbook: string; context: string },
  saved: boolean = false,
): string {
  return `<div class="page-heading"><h1 class="page-title">Agent</h1><p class="body">Set the approach. Your agent makes the moves.</p></div>
    <div class="editor-layout">
      <form class="panel form" method="post" action="/agent">
        <div class="form-heading"><h2 class="section-title">Coaching</h2><p class="body">These instructions are copied when a match starts. All fields are optional.</p></div>
        ${saved ? '<p class="body" role="status">Agent saved.</p>' : ""}
        ${coachingField("Persona", "persona", agent.persona,
          "Describe your agent’s temperament and priorities.",
          "Play patiently. Check immediate threats before taking risks.")}
        ${coachingField("Playbook", "playbook", agent.playbook,
          "Give concrete tactics. Name the game when advice is specific to it.",
          "Tic-tac-toe: take a winning move first; otherwise block an opponent’s immediate win.")}
        ${coachingField("Context", "context", agent.context,
          "Manually add lessons from matches you watched and goals for the next match.",
          "Goal for my next match: check whether my move gives the opponent an immediate win.")}
        <div class="form-footer"><span class="body">Changes apply to future matches.</span><button class="pill pill-primary" type="submit">Save agent</button></div>
      </form>
      <aside class="coaching-guide" aria-label="Coaching guide">
        <h2 class="section-title">A clear game plan</h2>
        <p class="body">Start with a few sentences in your own words. Use the examples as ideas for your instructions.</p>
        <p class="body">The current position and legal moves are supplied automatically. During Fleet placement, your agent receives placement instructions instead of a legal move list.</p>
        <p class="body">Up to 10 prior result lines are already included in the coaching snapshot. Context is for your own lessons and goals; update it yourself after watching a match.</p>
        <details>
          <summary>Example tactics for each game</summary>
          <dl>
            <dt>Tic-tac-toe</dt><dd>Take an immediate three-in-a-row win, then block an opponent’s immediate win. Otherwise, prefer the center and look for a fork: two winning threats at once.</dd>
            <dt>Four</dt><dd>Discs fall to the lowest open row in a column. Take a move that completes four in a row; otherwise block an immediate win. When neither is available, prefer the center column and check what your drop lets the opponent play above it.</dd>
            <dt>Checkers</dt><dd>Captures are mandatory. Compare the complete legal capture paths and avoid a landing square that allows an easy recapture. Men move and capture forward; kings can also move and capture backward. Reaching the king row ends that move.</dd>
            <dt>Fleet</dt><dd>Place ships of lengths 5, 4, 3, 3, and 2 in straight horizontal or vertical lines without overlap; ships may touch. Search untried cells, then follow a hit along its row or column. Avoid repeat shots and use only revealed information about enemy ships.</dd>
          </dl>
        </details>
        <div class="guide-rule"></div>
        <p class="body">Once play begins, the agent acts independently. Both coaching snapshots are public on the match page. Do not include private information or secrets.</p>
      </aside>
    </div>`;
}

function coachingField(label: string, name: string, value: string, description: string, example: string): string {
  return `<label class="field" for="agent-${name}"><span class="label-caps">${label}</span><textarea id="agent-${name}" name="${name}" rows="6" aria-describedby="agent-${name}-description agent-${name}-example">${escapeHtml(value)}</textarea></label>
    <p class="field-help"><span id="agent-${name}-description">${description}</span><br><span id="agent-${name}-example">Example: ${example}</span></p>`;
}
