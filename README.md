# BattleAI

Two coaches each configure an agent. The agents play. A third person can open the match URL and watch.

## Run

```bash
npm install
cp .env.example .env
```

Set `MODEL_BASE_URL`, `MODEL_API_KEY`, and `MODEL_NAME` in `.env`. `MODEL_BASE_URL` includes the version path and has no trailing slash, for example `https://api.openai.com/v1`.

```bash
npm run dev
```

Open http://127.0.0.1:3000. Register two coaches in two browsers, save an agent for each, create a match, and join it from the second coach. The spectator URL is the match address.

The app is one process and one SQLite file. Node.js 24 is the intended runtime.

## Coaching and Rankings

The Agent page describes Persona, Playbook and Context, with examples and optional tactics for each game. Save applies to matches that start afterward; existing coaching snapshots remain fixed. Your displayed coach name is an account label.

Rankings is public at `/rankings`, with all-game and per-game filters. It counts finished matches only, including forfeits, and shows each coach’s own forfeits as a subset of losses. Rank is based on wins, then unrounded win rate (wins/all finished matches), then matches played. Equal ranking statistics share a competition rank. Results use 50-coach pages. Only coach display names and match statistics are published.

## Replay and recovery

Select an activity card or use the replay slider to inspect a position. Previous/next, playback speed, and Return to live keep the board synchronized with the selected event. New activity continues arriving while inspecting history. Coordinates are visible in all four games. Fleet history preserves each viewer's ship visibility at the selected event.

Unexpected runner failures pause play and show a retry notice. Reloading an active match retries one runner per match. Missing model configuration leaves play paused. Server error logs include the match ID, without provider response details.

## Validation

Use Node.js 24, as required by `package.json`. Validation used Node.js 24.11.1.

```bash
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

The browser suite builds the app and runs an isolated in-memory fixture server on port 3108. It covers replay, live catch-up, Fleet visibility, recovery, keyboard controls, and desktop/phone layouts. It makes no paid model calls and does not use the development database.

GitHub Actions runs the `Validate` check on pull requests and pushes to `main`, with a manual trigger available after the workflow reaches `main`. It uses Node.js 24.11.1 on Ubuntu 24.04, installs the lockfile with `npm ci`, and runs the unit/integration suite followed by the build, type checks and Chromium suite. Focused tests fail CI. Failed browser runs retain an HTML report, traces and screenshots for seven days. Superseded runs are canceled; each run has a 15-minute limit. No application secrets are required.

Requiring `Validate` before merging is a separate branch-protection setting. GitHub currently rejects this setting for this private repository with “Upgrade to GitHub Pro or make this repository public to enable this feature.” Until the account supports it, CI reports failures but does not prevent merging. Once supported, require `Validate` on `main`, require the branch to be up to date, and enforce the rule for administrators.

## Match journey

Matches groups your active, waiting and completed matches, with links to resume, share an invitation or replay. Match pages provide Copy match link and a selectable manual-copy fallback. A signed-out invitation preserves its match destination through login/registration; taking a seat always requires Join match.

Recorded actions show actual Checkers captures/promotions and Fleet sinks. Winning Tic/Four lines follow the selected replay position. Completed matches show a factual final summary, with Edit agent and Create rematch for participants. A rematch creates a fresh waiting match for the same game; the opponent must choose to join, and current coaching is copied at that join.
