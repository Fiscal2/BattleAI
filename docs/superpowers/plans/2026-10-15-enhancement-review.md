# BattleAI enhancement review

Date: 2026-10-15. Source: `a0d68fd`, branch `codex/refine-match-ui`. Product source is unchanged during this review; the pre-existing untracked `.agents/project.json` is preserved. This document extends the existing design spec and the 2026-10-08 UI refinement plan. It proposes work, not completed implementation.

## Recommendation

Fix the two reproduced reliability defects, then deliver an interactive match viewer: selecting an action shows its historical position, boards print coordinates, and move cards describe actual consequences. Follow with active-match discovery, explicit invitations and a built-in scripted demo. Preserve the Castling palette, Geist fonts, panels and controls.

The ranking below is an engineering/product judgment based on current behavior. It is not a user study, delivery estimate or measured performance ranking.

## First: correctness and recovery

### F1. Classify unreadable replies correctly

Evidence: `src/model/client.ts:44-48` turns null/non-string content into `{error:"missing content"}`. `src/match/runner.ts:90-99` counts that as a provider failure. Spec lines 190, 198 and 200 instead classify it as an unreadable reply with three attempts and `invalid_action`.

Reproduction: the real client received a mocked HTTP 200 containing null content and fed the real runner in an in-memory database. After **two calls**, the match finished with **model_error**. No provider was contacted. Existing parser-only null coverage does not exercise this boundary.

Proposed change: distinguish response/content failures from transport/HTTP failures and preserve their separate retry budgets. Do not change legal-action validation. Owner paths: model client, runner and focused client/runner integration tests.

Acceptance: three null/unreadable responses cause `invalid_action`; two HTTP/timeout failures cause `model_error`; a valid response after allowed retries continues; counters reset on the next turn. Provider-body decoding errors should have an accurate category rather than all being called timeouts.

### F2. Recover a stopped runner and expose the actual state

Evidence: `src/match/runner.ts:191-195` catches an unexpected exception and removes the running entry while leaving the match active. `src/http/app.ts:264-267` renders a match without attempting to resume it. The spec at line 147 requires a later request to restart a missing loop.

Reproduction: a scripted completer rejected on Join. A later real `GET /matches/:id` returned HTTP 200, the completer call count remained **1**, the match stayed **active**, and no result event appeared.

Proposed change: wire safe request-triggered recovery through the existing duplicate-loop guard; add structured diagnostics and distinguish a connected event stream from an agent actively working. Do not add another service or repeatedly retry permanent errors without a bound.

Acceptance: a recoverable exception followed by a match request resumes from the last committed event, without duplicate actions; concurrent requests start one loop; missing model configuration does not forfeit; persistent failures have an observable terminal/recoverable state.

## Ranked product enhancements

### E1. Interactive action history and replay — highest visible value

Current: `src/web/feed.ts:109-139` produces passive cards. `src/web/client.ts:99-111` displays the latest view. Browser inspection found zero feed controls and zero playback controls, including on a completed match.

Deliver:

- Select a card by pointer, touch or keyboard to inspect the board after that event.
- Display “Position after #N”; add previous/next, playback and speed controls for completed matches.
- Keep live events arriving while inspecting history; provide “Return to live” and an unseen-action count. Pausing playback must not pause the server match.
- On phones, provide a compact Board/Activity switch or an explicit board jump and return to the selected card. Prefer one of these, rather than adding both by default.

Paths: client, feed, board, match HTTP view, CSS. The existing event log and `viewFor` provide the foundation. Historical views must be derived from the event prefix with the caller’s existing visibility rules. Redacted Fleet placement events are insufficient for unrestricted client-side reconstruction; do not send hidden state to make replay easier.

Acceptance: selecting an event displays the exact prefix position; repeated Four drops resolve to the right row; a Checkers multi-jump stays one action; Fleet visibility remains correct for both seats and spectators; earlier positions do not inherit the final result or later sunk-ship information. New events do not displace an inspected position; return-to-live restores the latest view. Keep controls keyboard accessible and respect reduced motion.

### E2. Make board graphics explain the game

Current: `src/web/board.ts:81-129` gives cells accessible coordinate labels but draws no visible axes/square numbers. Browser inspection confirmed this in all four games. `src/web/feed.ts:77` says “Moved a piece” for Checkers; Fleet at line 101 reports hit/miss but no sink. The fixture sank a 5-cell ship while its card still said “Shot hit.”

Deliver:

- Fleet A–J/1–10 axes, Four column labels, and Checkers square numbers.
- Actual consequences: “Captured 2 pieces,” “Promoted to king,” and “Sank a 5-cell ship.” Derive them from adjacent authoritative positions, never invented model reasoning.
- Compact Fleet ship-status indicators and a clear hit/miss/ship legend; highlight the complete winning line in the line games.
- Keep one set of SVG geometry and existing semantic colors. Use brief move transitions with a static reduced-motion equivalent.

Paths: rules view data where necessary, board/feed presentation, CSS. Historical consequences must be evaluated at that event, not inferred from the final position.

Acceptance: every feed coordinate maps to the printed board; both length-3 ships sink independently; quiet moves are not captures; kinging and winning lines are accurate; no hidden Fleet cells leak. Verify desktop, phone and zoomed layouts.

### E3. A useful match home and explicit invitations

Current: `src/http/app.ts:214` calls `record()`, whose query at `src/store/db.ts:337` includes only finished matches. Browser fixtures contained three active and one waiting match, but the home page listed only the one finished match. Waiting pages at `app.ts:391` instruct users to copy the URL manually.

Deliver: list the coach’s waiting, active and completed matches with status, opponent and a resume/watch link. Add “Copy match link,” confirmation and a selectable-URL fallback. Explain that opening the link watches; taking a seat requires a signed-in coach and an explicit Join. A rematch can create a new invitation with the same game, without automatically committing the other coach.

Acceptance: unfinished matches remain discoverable after leaving the page or restarting the app; another coach’s private account history is not listed; clipboard denial is handled; copying/opening never takes a seat. Keep match creation and joining semantics intact.

### E4. Built-in demo mode and readiness

Current: shipped `src/server.ts` uses only configured model completions; Join rejects missing configuration at `src/http/app.ts:251-252`. The prior live demo used a temporary local runner. Waiting GET pages do not display model readiness before the user attempts Join.

Deliver: an explicit scripted demo option with a built-in opponent, visible mode badge and match-level provenance. Provide a readiness notice before Join. Keep live-model play distinct and do not expose keys or imply that the script interprets free-text coaching. Reuse the existing completer seam and real rules/event log; no second application or external service is needed.

Acceptance: a fresh checkout can run a demo without a provider key or second browser; a restart preserves the match’s mode; results remain labelled scripted; ordinary live matches still require configuration. Verify both modes and a missing/invalid configuration path without paid requests.

### E5. Coaching that is easier to improve

Current: `src/http/app.ts:178-208` exposes three textareas and redirects after Save without a dedicated saved indication. Match-start snapshots already preserve past instructions (`src/store/db.ts:191-219`).

Deliver: visible save confirmation, unsaved-change protection and opt-in coaching examples that fill editable text. Add a human-readable coaching revision to each match so a coach can compare what they changed between runs. Show a concise post-match factual summary and a link back to edit the next version.

Acceptance: examples never overwrite existing text without intent; a save is visibly confirmed; editing never alters an existing match snapshot; returning from a result identifies that match’s coaching version. Do not claim a strategy is better based on one result or automatically generate unsupported explanations.

### E6. Model visibility and bounded resource use

Current: `src/model/client.ts:12` retains only content/error; match rows contain no model identity or duration/usage data. `src/match/runner.ts:158-171` guards duplicate loops per match, but does not cap total simultaneous model calls.

Deliver, before broader live-model use: record model/run mode, actual attempt duration, retry category and provider-reported usage when present. Show a restrained “choosing a move” state and actual elapsed time. Add a small configurable process-wide call limit and explicit match budgets. Unavailable usage stays unknown, not zero. Avoid raw prompts/replies and hidden information in public diagnostics.

Acceptance: scripted tests verify concurrency limits, retry reporting and budget exhaustion; no duplicate model call is created for one turn. Provider/configuration-specific output limits require documentation verification during implementation.

## Performance work: measure before expanding architecture

Confirmed repeated work: every turn rereads and folds event history (`runner.ts:63,177,185`); SSE derives a view for each event by reading/folding its prefix (`app.ts:290-292`). This supports investigating growth with match length and viewers; it does **not** establish a measured classroom latency problem.

First benchmark long scripted Checkers/Fleet matches with multiple viewers, counting reads and measuring server CPU/response time. If material, add indexed `lastSeq`/`eventsAfter(seq)` queries and cache active state within the existing process, rebuilding from events on restart. Recheck reconnect ordering and Fleet isolation. Preserve single Node/SQLite architecture; no speculative queue, cache service or database migration.

## Suggested delivery order

1. F1/F2 and focused regression tests.
2. E1 plus the coordinate/consequence portions of E2: the next visible release.
3. E3/E4: make it reliable to invite, find and demonstrate a match.
4. E5 and factual summaries; E6 before expanding live-model usage.
5. Performance changes only if the benchmark supports them.

Each implementation should use the established complete-review/test/PR workflow. This audit does not authorize implementation, public deployment, new services, model spending, mid-match coaching or additional games.

## Actual validation and scope

- Fresh Node 24.11.1 `npm test`: **101 tests passed**, 13 files. `npm run build`: server/browser type checks and minified build passed. Passing baseline tests did not cover the reproduced F1/F2 paths.
- Two isolated local probes reproduced F1 and stopped-runner behavior. A real HTTP Join then GET probe separately established missing request recovery. All used fake completions and in-memory SQLite.
- Independent design assessment and browser evidence were collected separately, plus an independent backend audit. Browser inspection used Chromium through the already installed neighboring Playwright harness, isolated contexts and an in-memory server on 3107. Eight game/viewport captures: 1440×1000 and 375×812. No horizontal overflow in those captures. Fleet’s mobile feed began at y≈1296 in an 812px viewport, requiring scrolling to see it.
- The browser evidence probe initially waited for an obsolete `.waiting` selector. Desktop captures were preserved; remaining mobile captures and the waiting-state inspection were completed using the actual board caption. That harness timeout is not an application defect. No screenshot was retaken. Browser observations establish layout/control presence, not complete E2E delivery or physical-device behavior.
- Impeccable’s mechanical scan reported only its generic Geist-family warning; the approved Castling visual system explicitly requires Geist, so this is not a proposed design change.
- Clef `finding` review on the reproduced F1 packet returned **demonstrated**, reachability **shown**. Evidence digest `94f1aedb70e59f9cc1093fbeda06279389b23f857714a5eca5c48520e11437da`; state 1,602 bytes, no redactions, one request. This advisory judgment agrees with the executable probe; it is not a passing test or whole-codebase certification.
- The isolated fixture server was stopped after the review. No product code, saved accounts or matches changed. No live game model, deployment, dependency installation or performance benchmark ran. This is not a full security audit or WCDF/game-rules recertification. Existing historical/out-of-scope features were treated as scope choices, not defects.

Next action: choose the next implementation scope. The recommended package is F1/F2 followed by E1/E2. Maintain the current Castling identity throughout.

## Authorized implementation: fixes, replay and coordinates

User approved F1/F2, interactive replay (E1) and visible coordinates from E2 on 2026-10-15. Other backlog items remain proposals.

Execution starts from a0d68fd on `codex/replay-and-recovery`. The prior Castling UI PR #1 remains open; this follow-up depends on that branch until #1 merges. Preserve its visual patterns and the unrelated `.agents/` identity file.

Implementation contract:

- Distinct invalid-reply/provider retry budgets through the real client/runner boundary; recover missing loops on match requests without duplicate committed moves. Unexpected failures expose only a safe paused status, not prompts/errors.
- Read-only `GET /matches/:id/position?seq=N` returns `{seq,view,firstSeat,names,result}` for event prefix N, including N=0. It validates exact bounds, uses the current caller's visibility, never restarts a runner and sets private/no-store caching. Before the second seated event, view and firstSeat are null. Result is derived only from prefix result events.
- The browser retains latest live state separately from inspected state. Native action buttons, previous/next, range seek, playback/speed and Return to live inspect server positions. Late fetches cannot override newer selections or live mode. New events append during inspection. Playback pause never pauses the server. Mobile has an explicit jump to board controls.
- Fleet axes A–J/1–10, Four column numbers, Checkers square numbers and Tic row/column labels are visible; all existing accessibility and Fleet isolation remain.
- No schema migration or new runtime dependency is planned.

Plan audit: historical replay cannot use the latest result or current sunk-ship list; Fleet redacted placements cannot be reconstructed client-side. History endpoints must stay read-only. Rapid seek and Return to live require request cancellation/generation guards. Completed live streams close even when inspecting an earlier position. Recovery must register a loop before any synchronous failure and must not spin on repeated exceptions. Empty/waiting positions and forfeit-with-ongoing-board are first-class cases.

Checks: meaningful red/green regression slices; server and browser type checks; all project tests; isolated real-browser completed/live replay, rapid seeks, keyboard/mobile coordinates and both Fleet seat/spectator views; independent code review and focused Clef review after executable evidence. Record actual results below before delivery.

Independent plan audit resolved two edge cases before integration: event frames include authoritative prefix `firstSeat`/names, including Fleet. If another coach joins while #0/#1 is being inspected, retain inspection and defer the existing heading/snapshot page refresh until Return to live. Operational runner notices (`running`, `stopped`, `unconfigured`) travel without a committed event/sequence and update only live status; a connected browser must observe a stopped runner before a later request recovers it. Error details remain private.

### Delivered implementation and evidence — 2026-10-16

- F1: the real completion client distinguishes invalid content from provider/transport failures. The runner preserves separate budgets and resets them per turn. New client-to-runner tests exercise null/non-string content, HTTP failure, malformed response JSON, timeout, synchronous throws and mixed retry categories.
- F2: loop registration precedes work; unexpected errors release the guard, keep matches active, emit a safe match-ID diagnostic and notify connected clients. Match-page and stream requests recover a missing loop without duplicating committed actions. History reads remain pure. Missing configuration keeps matches paused.
- Replay: prefix-derived board/participants/result, server-side Fleet visibility, action selection, keyboard range seeking, previous/next, playback/speed and live catch-up. Superseded loads are canceled and ignored. Fetch failure preserves the displayed board. Waiting inspection survives a join and defers heading/snapshot refresh until Return to live.
- Coordinates: Tic rows/columns, Four columns, Checkers squares 1–32, Fleet A–J/1–10. Existing cell accessibility labels and board cell counts remain intact. Styling retains Castling tokens, typography and controls.
- New test-only Playwright harness uses an in-memory database and injected scripted completions on localhost:3108. It requires Chromium installation and Node 24. No development accounts/database or live game-model provider were used. No schema migration or runtime dependency was added; Playwright 1.63.0 is development-only.

Observed red/green evidence:

- New historical-position HTTP tests failed with 404 before the endpoint existed, then passed. Request recovery tests failed before the recovery path, then passed.
- Independent browser review measured a 352px activity card with a 10px action button after the initial clickable-card integration. The button now spans the parent grid and defines its own internal columns. Real screenshots confirmed the correction; regression assertions check button width across all four games at desktop and phone widths.
- Recovery diagnostics initially used Fastify's disabled default logger. A new assertion failed (`app.log.level` undefined); enabling the error logger made it pass. The test also verifies exactly one safe diagnostic with match ID and no raw exception. No deprecated logging option remains.
- The first browser run passed six workflows and failed one obsolete test locator (`Return to live` on a completed match). The locator now uses the shipped `Return to latest` label. This was a harness failure, not a product failure.

Final checks on Node 24.11.1:

- `npm test`: **152 passed**, 18 files.
- `npm run test:e2e`: server/browser type checks and minified bundle build passed; **8 Chromium workflows passed**. Covers completed replay and forfeit history; live unseen events and deduplication; delayed/stale selections, failed load and retry; both Fleet seats and spectator; Four/Checkers coordinates; join during inspection; connected paused notice and concurrent recovery; desktop/375px layouts, card widths, keyboard controls, mobile board jump and reduced motion.
- `git diff --check`: passed. Independent review additionally ran 58 focused tests and final recovery tests, inspected generated bundle consistency, and approved after both findings were fixed.
- Impeccable detector: five generic Geist-family warnings only; approved Castling typography intentionally retained. Desktop/phone board captures inspected. Full-page captures can omit offscreen activity content because the existing `content-visibility:auto` optimization skips painting it; viewport interaction and visible-card screenshots establish the actual activity layout.
- Clef final focused historical Fleet review: `no_defect_demonstrated`, evidence gap `none`, evidence digest `512a805dd7e7aa5d7299284ba8cf439e316a7b8e5eaf534604ceddcf165a909e`; 2,017-byte state, no redactions, one request. Advisory evidence only; confidence is limited, and this is not a whole-application security certification. Implementation slices also received focused Clef reviews.

Limitations and rollout: Chromium desktop/mobile emulation only, no physical-device or cross-browser certification. Provider behavior was tested through controlled HTTP/client fixtures, without paid model calls. No realistic-scale performance benchmark was requested or performed; no latency/throughput improvement is claimed. The app remains a single-process Node/SQLite service. Build/restart is required to serve the new browser bundle. The repository has no configured GitHub Actions workflows; local evidence is recorded above. Delivery remains stacked on open PR #1 until that dependency merges; do not merge the follow-up before retargeting and rechecking against the integration branch.
