# BattleAI UI refinement

Work item: 2026-10-08 request to enhance the existing Castling UI, especially the agent action history, and improve performance. Starting revision: dcea5a4. Preserve the approved four games, match rules, coaching snapshots and Fleet visibility.

| Acceptance | Change surface | Verification |
| --- | --- | --- |
| Castling visual identity with stronger hierarchy | Shared page shell, match and form HTML, app.css | Actual desktop and mobile renders; fonts and navigation |
| Readable visual action history for all games | Browser feed and pure event formatter | Move, placement, result and redacted-placement tests; browser match views |
| Responsive, accessible boards and controls | Board renderer, CSS and semantic HTML | 375px/desktop overflow, keyboard focus, reduced motion |
| Efficient live updates | Batched initial feed, append-only entries, no completed stream, conditional board renders | SSE completion/reconnect/dedup probes; production bundle size |
| Correct outcome and no hidden Fleet information | Match bootstrap, feed descriptions and server filtering | Forfeit display, seat vs spectator regression checks |

Plan audit: derive only observed outcomes; do not invent agent reasoning or statistics. Hidden Fleet placements must remain redacted in graphics. Completed forfeits need the stored result because the board outcome may still be ongoing. SSE connection state and match state are distinct. Long names/coaching must wrap without horizontal scrolling. Use SVG game geometry and existing self-hosted fonts; no external asset or UI dependencies.

Validation before changes: 61 tests pass on Node 24.11.1; npm build passes. Browser evidence and final checks pending. Initial untracked .agents/project.json is preserved. Remote is Fiscal2/BattleAI. Implementation and independent review are separate responsibilities.

## Delivered change and evidence

- Shared shell, login/register, coaching and match selection refined with Castling tokens, pills, self-hosted fonts and SVG game geometry. Match board and action timeline sit alongside each other on desktop; phone layouts stack without fixed-width grid overflow. Coaching snapshots are below.
- Action history is chronological, readable and uses real coordinates and small move diagrams. Fleet shots use observed hit/miss results. Redacted placements produce no coordinates or diagram. No fabricated rationale or metrics.
- Initial feed insertion is batched; subsequent sequences append once. The feed follows new actions only when the reader is near the bottom. Captions and results preserve existing board nodes. Completed streams close. A waiting page reloads once when a coach joins so server-owned participants and coaching snapshots are accurate.
- Production bundling now minifies JavaScript; the final browser bundle is 13,467 bytes (13.2 KiB). Server and browser have separate TypeScript checks. No dependencies or external image requests added. No general latency or scale benchmark claim is made.
- SSE resumes after the greater validated query/header cursor, flushes idle headers immediately, and cleans up listeners on response close.

Validation on Node 24.11.1:

- `npm test`: 101 tests pass in 13 files. Added 40 checks covering feed formatting, safe DOM rendering, lifecycle/retries, board accessibility labels, authoritative forfeit results, Fleet redaction and strict resume-cursor bounds.
- `npm run build`: server/browser TypeScript checks and minified bundle pass. `git diff --check` passes.
- Chromium through the Playwright 1.63.0 harness used the existing FiscalFundamentals installation and a disposable in-memory BattleAI server on port 3107, with scripted model completions; no live provider or production data. Real workflow passed: register two coaches → save coaching → create match → spectator connects while waiting → second coach joins → both snapshots/participants appear → agents play to result → reload preserves event sequence → result appears in match record. Invalid login, completed forfeits, keyboard focus and reduced-motion behavior were exercised. No page errors or failed asset requests.
- All four games plus waiting/forfeit views were rendered at 1440px and 375px; overflow assertions passed. Baseline Fleet at 375px overflowed to 459px. Final phone layouts fit 375px. Screenshot inspection confirmed the action graphics and responsive composition; scrolling into the activity region renders deferred timeline rows.
- First browser workflow run used `getByLabel` after saved textarea content changed the label text seen by that selector; the form values were present. The harness was corrected to accessible textbox-role selectors, and the entire interaction workflow then passed. Layout screenshots were inspected in two bounded rounds.
- Independent review reproduced the reconnect bug (query 1/header 3 replayed 2,3,4). It was fixed; reviewer confirmed only event 4, idle headers before body, delivery after GET completion, and zero listeners after both responses closed. No actionable issues remain in the scoped review.
- Impeccable detector found only the explicitly required Geist-family warning; the Castling spec requires those fonts, so they were preserved.
- Clef advisory inference was attempted by the independent reviewer and returned exit 2: Cloudflare login needs renewal. No Clef judgment was obtained. A final focused Fleet-isolation payload was prepared and inspected locally: 1,830 state bytes, no redactions. Inference was not retried against the unchanged authentication blocker. This unavailable advisory check is separate from passing executable checks.

No database migration, deployment, live-model call or game-rule change. Browser runs used an external installed harness; no browser harness was added to this repository. PR/CI status is recorded by the actual GitHub PR after publication. Existing untracked `.agents/project.json` remains untouched and unstaged.
