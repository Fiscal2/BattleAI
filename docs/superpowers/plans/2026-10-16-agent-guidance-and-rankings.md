# Agent guidance and Rankings

## Work item

Source: user request 2026-10-16. Base `0dc8423` on `codex/coach-and-rankings`; depends on open replay PR #2 until that work reaches `main`. Preserve unrelated `.agents/` identity data and prior plans. Node.js 24.11.1, existing Fastify/SQLite/server HTML and Castling visual system. No deployment, live model requests, schema migration or runtime dependency planned.

Confirmed choices: keep “Dev Coach” as a noninteractive signed-in display name; no profile/account page. Rankings count every finished match, including model/provider-error forfeits; show forfeit wins/losses separately.

## Acceptance and implementation

- Agent: inline descriptions and examples for Persona, Playbook, Context; preserve saved text and allow empty instructions. Explain supplied game position/legal actions, manual context, up to ten automatic prior result lines, and public match-start coaching snapshots. Native expandable examples cover all four games. Accessible descriptions; visible confirmation after Save. Component in `src/http/agent-page.ts`; existing authenticated routes remain authoritative.
- Rankings: public read-only `/rankings` and navigation entry, using display names and aggregate statistics only. Wins/losses/draws/played/win rate, with forfeit W/L included and explained. Waiting/active matches excluded. All games and each game filter. Sort wins descending, win rate (wins/played, including draws in denominator) descending, then played descending; identical statistics share competition rank, with stable name/ID ordering. Fifty rows per page, rank before pagination, clear empty/invalid input handling and own-row marker.
- Storage: aggregate from existing seats/matches/coaches with bounded rows and count, no per-row queries or extra service. Inspect the query plan; do not claim realistic-scale performance from a functional test.
- Design: preserve dark Castling panels, typography, pills and hairlines. Agent remains a form with concise field help and an aside. Rankings is a semantic table with an intentionally scrollable region on narrow screens, compact filter and pagination. Public pages show neither account emails nor coaching text. Keep the account label visually distinct from navigation.

## Plan audit

Count finished matches from each seated coach's perspective, independent of first player. Draws cannot become losses. Forfeits are subsets of wins/losses, not extra matches. Identical display names must remain distinct coaches. Ranking ties must survive pagination and filtering; query filtering precedes ranking. Unknown/repeated game or page parameters are rejected. Empty rankings must be useful for signed-out and signed-in users. Use session identity only for the own-row marker, with private/no-store caching; escape names and field values. Saved confirmation does not alter existing match snapshots. Do not infer coaching quality from examples or advertise stronger play.

## Verification and continuation

Independent reviewer audits plan and final diff. Focused storage/component/HTTP tests, full suite, server/browser build, real Chromium Agent save/reload/new-match snapshot and Rankings filter/pagination/empty/privacy workflows, desktop/phone inspection. One focused Clef packet after executable evidence, then commit/push completed PR, verify actual head/base/checks/conflicts. Repository currently has no GitHub Actions workflows; record available evidence without claiming hosted CI passed.

Execution: implementation underway; no checks from earlier work count as evidence for this feature. Main owns routes/nav/styles/browser integration, separate workers own the Agent component and Rankings storage, reviewer read-only.

Independent plan audit resolutions: ties use exactly wins, unrounded wins/played, played (loss/draw/forfeit breakdowns do not break ties); test a shared rank across rows 50–51 and rank skipping. Beyond-last positive pages return 404, empty page 1 returns useful 200, malformed parameters/unsafe offsets return 400. Game form resets page and pagination preserves filter. Browser fixtures must distinguish finished games, draws, both forfeit causes/seats and active/waiting exclusion; exercise Agent text before/after Join. Phone checks include authenticated header wrapping and keyboard scrolling in the ranking region. Fleet placement receives placement instructions instead of an enumerated legal-action list; help copy must reflect this.

## Delivered evidence — 2026-10-16

Implemented Agent editor component, accessible descriptions/examples and optional game tactics, with save confirmation through the existing authenticated route. Existing field values and empty instructions remain unchanged; started snapshots remain fixed. Added public Rankings and navigation for signed-in and signed-out users. The account display name remains a span. Rankings implements the agreed aggregates, forfeits, filters, shared competition ranks, stable ties, 50-row pages, own-row marker, useful empty/error states and private/no-store responses. No new runtime dependency or schema/index change.

Independent plan review resolved tuple tie semantics, pagination bounds, distinguishing fixtures, and authenticated mobile/keyboard coverage before delivery. Independent final diff/screenshot review found no actionable defects or blockers. Review was read-only.

Actual checks on Node 24.11.1:

- `npm test`: **178 passed**, 21 files (26 added tests since base). Store cases cover both winner/first seats, both forfeit causes, draws, active/waiting exclusion, duplicate/case-equivalent names, unrounded win-rate sorting, game filtering, ties across rows 50–51 with the following rank skipped, and an upper bound of two query preparations per request. HTTP cases cover public data/escaping/privacy, invalid/duplicate bounds, empty and beyond-last pages, authentication and save/snapshot behavior.
- `npm run test:e2e`: server/browser type checks and minified bundle passed; **11 Chromium workflows passed**, final run 10.7 seconds. Three added workflows exercise Agent accessible descriptions/native examples, Save/reload, waiting-match Join snapshot capture and later-edit isolation; public Rankings count/filter/empty/error/pagination/ties; signed-in desktop/375px header, own marker, no document overflow, focus and native horizontal keyboard scrolling. All eight earlier replay workflows remain green.
- Meaningful red evidence: new HTTP tests initially returned 404 for Rankings and `/agent` instead of the new save-confirmation redirect. These pass after wiring. Subsequent harness corrections matched the existing signed-out GET redirect (302), used accessible textbox roles where a label wraps saved textarea text, and used ArrowRight for native horizontal scrolling (End is vertical). Initial 9/11 E2E result became 11/11; these harness failures were not product defects.
- Desktop/phone Agent and Rankings screenshots inspected in one batched round, followed by a confirmation after adding a mobile scroll hint and precise tie copy. The layouts retain Castling typography, dark surfaces, ghost/white pills and hairlines. No raster assets or new browser script was needed.
- Impeccable detector: five generic Geist-family warnings only; Castling explicitly retains Geist. `git diff --check` passed.
- Clef focused aggregation/tie/pagination advisory: `no_defect_demonstrated`, evidence gap `none`; evidence digest `e2756b8bd36932623a8257054eeddc62ee936f3b8ecee4af3bf4ef8125c1522d`. Inspected 1,913-byte state, no redactions, one inference. Limited-confidence advisory, not an executable test or whole-app certification.
- Storage query plan inspected over a fixture of 1,000 coaches and 10,000 matches: seat scans, primary-key lookups and temporary grouping/sorting. Aggregation/count run in one read transaction; row output is bounded and no per-coach reads occur. This is query-plan inspection, not a realistic-scale latency benchmark or a capacity claim; no speculative index/cache service was introduced.

Browser tests used an isolated in-memory server with seeded result records and injected completions; no saved user coaching/database changes, live provider calls or deployment occurred. Physical devices and non-Chromium browsers remain unverified. The repository has no configured GitHub Actions workflows; all reported checks are local. Build/restart applies the UI; no migration or environment variable is required. Delivery remains stacked on open replay PR #2 and must retarget/revalidate against `main` once its dependencies merge. Never merge automatically.
