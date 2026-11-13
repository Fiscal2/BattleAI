# Light mode and theme toggle

Source: November 12, 2026 request to add light mode and a user toggle. Base: `ec5216c` on the pending accessibility PR #6. Preserve Castling layout, typography, game behavior, and unrelated local files.

## Acceptance and plan

| Criterion | Implementation | Verification |
| --- | --- | --- |
| Light and dark across public and signed-in pages | Shared CSS tokens, including boards, activity, controls and status accents | Desktop/phone axe scans and visual inspection of both themes |
| Discoverable keyboard toggle | Shared header native button with stable Dark mode label and pressed state | Tab/Enter/Space, focus retained, mobile layout |
| Initial device preference; persistent user override | Small head script reads validated local storage before styles; listens for system and cross-tab changes | Reload/navigation, system changes, cross-tab changes and first-paint checks |
| Storage unavailable | Toggle still changes current page without throwing | Browser storage-failure scenario |
| Existing journeys preserved | Separate theme bundle; no match-client initialization on unrelated pages | Full unit/integration, build/type checks, browser suite |

Plan audit: handle hard-coded dark colors as well as root tokens; keep script out of the match bundle; hide the control if JavaScript is unavailable; preserve the default dark page without scripts; allow header wrapping at intermediate widths. A browser-local preference needs no account schema or migration. No hosting, billing, or deployment changes.

## Delivery

The theme branch depends on PR #6's accessibility fixes and axe regression harness. Target that branch while #6 is open; after #6 merges, retarget to main and recheck diff, head and CI. Do not merge without authorization.

## Validation and review

- `npm test` on Node 24.11.1: 269 tests passed across 28 files.
- `CI=true npm run test:e2e` on Node 24.11.1: build and both TypeScript checks passed; all 38 Chromium workflows passed (36.7 seconds). Includes nine routes × two themes × two widths, keyboard activation, initial theme before body content, persistent overrides, invalid/blocked storage, cross-tab changes and no-JavaScript fallback.
- Focused theme/accessibility run: 21 passed; independently authored tests. The final full run above used the pinned runtime.
- Desktop/phone captures of Agent, Matches and Fleet in both themes: inspected representative images, verified no page overflow; compacted the phone toggle to a 44px moon button while retaining its accessible name. Independent review additionally checked 320–1440px layouts and found no actionable issues.
- Clef focused persistence/storage-failure review: `no_defect_demonstrated`, evidence gap `none`; digest `b1b262f504ea29e5089349a8bb57e6ae1a06c940618386b36f99d2178291d1b2` (1,903 bytes, zero redactions). Advisory only.
- Design detector: only five existing Geist/Geist Mono font warnings. Preserve the user's Castling typography.
- `git diff --check`: passed. Production theme bundle: 901 bytes before transfer compression; no new dependencies. Local port 3001 serves the built theme bundle byte-for-byte.

No Safari/Firefox, physical-device or screen-reader certification is claimed. No new PageSpeed Insights score is claimed. Hosted CI evidence belongs to the delivery PR; deployment remains outside this change.
