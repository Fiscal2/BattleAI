# Continuous integration

## Scope and acceptance

User approved CI for build/type checks, unit/integration tests and browser tests, with passing checks required before merging. Base `afb0e659be1601d586a31d90888ec8241b679008`; branch `codex/add-ci`. Preserve unrelated `.agents/`, `output/` and `tmp/` files. No application behavior, dependency, database, deployment or billing change.

- One stable GitHub Actions `Validate` job runs on pull requests, pushes to `main` and manual dispatch. Use Node 24.11.1, `npm ci`, `npm test`, Playwright Chromium/system dependencies and `npm run test:e2e` (includes both TypeScript checks and production browser bundle).
- Keep workflow access read-only, official actions pinned to verified commit SHAs, credentials out of the checkout, a 15-minute timeout and cancellation of superseded runs. Use the existing in-memory browser fixture server; no application secrets or live provider calls.
- Fail CI on focused tests. Retain browser failure reports, traces and screenshots for seven days. Keep local reporter behavior and existing single-worker isolation.
- Require `Validate` on `main` if the repository's plan supports branch protection. Do not change billing, visibility or broader account permissions to enable it.
- Independently review, run local gates including CI-mode browser tests, run one focused Clef advisory, commit/push a completed PR and verify actual hosted checks/head/conflicts. Do not merge this new PR without authorization.

## Plan audit and current evidence

Confirmed GitHub Actions is enabled, repository is private and `main` is unprotected. Official action release commits resolved through GitHub on 2026-10-30: checkout v7.0.1, setup-node v7.1.0, upload-artifact v7.0.2. setup-node/upload-artifact support Node 24 and all selected inputs. Vitest 4.1.11 already rejects focused tests when `CI` is set; Playwright now does too. No duplicate build command or new package is needed. Independent review and local/hosted results pending.

Branch-protection PUT requested strict `Validate`, administrator enforcement, no forced reviews/restrictions; GitHub returned HTTP 403: “Upgrade to GitHub Pro or make this repository public to enable this feature.” No setting was changed. Enforcement remains explicitly blocked on account capability; billing/visibility changes are outside this task.

Initial CI-mode local run: 269 tests passed; build/type checks passed; browser suite 16/17 passed. Failure diagnostics were generated: HTML report, screenshot and trace. `journey.spec.ts:112` manually reloaded a waiting rematch after the server's seated event already requested a refresh, producing `Page.reload: Not attached to an active page`. The existing test now awaits a live connection before Join and then asserts the automatic refreshed active status and revised snapshot. No application behavior, retries or assertion scope was weakened. Full final checks pending.

## Review and local validation

- Actionlint 1.7.12: passed. Downloaded the official Darwin arm64 release to a temporary directory and verified its published SHA-256 checksum; no project dependency added.
- `CI=true npm test` on Node 24.11.1: 269 tests passed, 28 files.
- `CI=true npx playwright test tests/e2e/journey.spec.ts -g 'a final summary' --repeat-each=5`: 5/5 passed after the synchronization fix; zero retries.
- `CI=true npm run test:e2e`: build, server/browser type checks and all 17 Chromium workflows passed, 16.3 seconds. Deliberate temporary Vitest and Playwright `.only` probes each failed with exit 1 and the focused-test error; both probe files removed. Failure diagnostics were observed in the initial run, not inferred from settings alone. No application secrets, development database or live game-model calls.
- Independent workflow/config and test synchronization reviews: no actionable findings; independently checked actionlint, focused-test settings, reporter/trace paths, pinned action input support and single-worker/zero-retry isolation. The rematch assertions verify the app's own refresh after Join.
- Clef focused CI-gate advisory: `no_defect_demonstrated`; evidence gap `execution` (hosted Ubuntu had not run). Digest `17ea8aae0e6a3d602e31429949b1f56360a58d24d053f13aa37588f672515a6b`; 1,672-byte inspected state, zero redactions, one request. The first oversized packet was rejected locally; a draft excerpt was corrected before any inference. Advisory is not an executable test or proof of hosted execution.
- `git diff --check`: passed. Hosted Linux, `npm ci` and upload-action execution will be verified after creating the PR. Required-check enforcement remains blocked by the GitHub plan restriction above.

## Hosted delivery

[PR #5](https://github.com/Fiscal2/BattleAI/pull/5) targets `main`. First hosted [CI run](https://github.com/Fiscal2/BattleAI/actions/runs/41075543760) passed at implementation commit `1d395b9ecff38cb9f872f6124dbd9cc478825133`: `Validate` completed in 1m41s on Ubuntu 24.04, including `npm ci`, 269 unit/integration tests, production build/server/browser type checks and all 17 Chromium workflows (40.5 seconds). Failure artifact upload was correctly skipped on success; its hosted failure path is not claimed exercised. Local failure trace/report/screenshot generation was observed, and the matching upload action inputs were independently reviewed. No cross-browser or physical-device certification is claimed.

This final work-record-only follow-up will trigger CI again. The current PR check/head and published description are the source of final hosted status. No new implementation or test change follows the passing run. The separate branch-protection request remains blocked by GitHub's account-plan restriction; no billing, visibility or permission workaround was performed. The PR is not merged without further authorization.
