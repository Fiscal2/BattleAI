# BattleAI design

Date: 2026-09-30. Revised the same day after review.

BattleAI is the class implementation of the Coach & Agent proposal (2 pages, PDF dated 2026-09-15). The proposal is the requirements source. This file records the decisions made from it.

## Purpose

A classmate opens a browser and uses the app with no install. A coach writes how an agent should play. The agent plays. Another coach’s agent is the opponent. A third person opens the match URL with no account and can follow the game and read how each agent was coached.

The demo bar from the proposal: two people each coach an agent, they run a match, and a third person understands it from the spectator link.

## Product decisions

- The model chooses every action. The server owns the rules, validates the action, and decides what each seat can see.
- The class product is the coach, match, and watch loop. It has no mid-match coaching and no mid-match adjustment.
- Four games ship: tic-tac-toe, Four in a Row, checkers, and Fleet. Screen titles for the two commercial examples are generic. CONNECT 4 and BATTLESHIP are Hasbro trademarks. The proposal says the class project uses generic classic games.
- One coach has one agent. Persona, playbook, and context are text. A match stores a copy of them. Later edits apply to later matches.
- Spectators see full information, including both fleets. An agent in Fleet does not see the opponent’s unhit ships. The other three games are perfect information. A seated coach who opens the match URL signed out receives the spectator view. That does not change the match, because the coach cannot send a move.
- Live updates are server-sent events. The browser does not submit moves.

## Out of scope

Seasons, ratings beyond a list of results, more than one agent per coach, mid-match messages, draw offers, resignation, clocks, and any game other than the four below. Bluffing and negotiation games are the long-term direction in the proposal. They are not in this version. A second process against the same SQLite file is unsupported.

## Runtime

One Node.js process. `package.json` sets `"engines": { "node": ">=24 <25" }`. Node.js 24 is the Active LTS line on 2026-09-30 ([Node.js Release schedule](https://github.com/nodejs/Release)). TypeScript is the language for the server, the rules, and the browser client.

SQLite is the database, through `better-sqlite3`, in a single local file. That file is not part of the source tree. The HTTP server is Fastify. The version installed is whatever the lockfile records at install time.

Password hashes use the `argon2` package defaults: Argon2id, `memoryCost` 65536 (64 MiB), `timeCost` 3, `parallelism` 4 ([node-argon2 `defaults`](https://github.com/ranisalt/node-argon2/blob/master/argon2.cjs)). OWASP’s minimum for Argon2id is 19 MiB, 2 iterations, and parallelism 1 ([OWASP Password Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)). The package defaults are above that minimum. The app does not pass custom cost options.

`MODEL_BASE_URL`, `MODEL_API_KEY`, and `MODEL_NAME` are required to start a match. `MODEL_BASE_URL` includes the API version path and has no trailing slash, for example `https://api.openai.com/v1`. Pages and agent editing still load when any of those variables are unset.

There is no second service and no job queue. The match loop runs in this process. Model calls are awaited inside that loop. The app is one process against the SQLite file.

## Modules

| Module | Responsibility |
| --- | --- |
| Rules | One file per game. Pure functions. No I/O. |
| Model | One HTTP call. Returns an action or a failure. |
| Match | Asks the rules whose turn it is, calls the model, appends events, detects the end. |
| Store | Coaches, sessions, the agent, matches, events. |
| Web | Account pages, the agent form, the live board, the replay, the match record. The stylesheet is the visual system below. |

A game module implements:

- `start(sides) -> state`
- `turn(state) -> seat`
- `legalActions(state, seat) -> Action[] | null` — `null` only while Fleet is waiting for a placement
- `validate(state, seat, action) -> "ok" | reason`
- `apply(state, action) -> state`
- `view(state, seat | "spectator") -> observation`
- `outcome(state) -> "ongoing" | { winner: seat } | "draw"`

When `legalActions` returns a list, a reply is accepted only when `validate` returns `"ok"` and the parsed action is deep-equal to one element of that list. When `legalActions` returns `null`, the prompt states the Fleet placement rule instead of a list, and `validate` is the acceptance test. `legalActions` during a checkers capture returns only the legal jumps, each as the full path. The match runner does not special-case a game. Fleet placement is the first two turns of the Fleet state: seat 0, then seat 1.

## Games

The server assigns the first seat with `crypto.randomInt` and stores it in `matches.first_seat` as `0` or `1`. In tic-tac-toe that seat is X. In checkers that seat is Red. In Fleet that seat shoots first, after both placements. Replay uses the stored value.

Actions are JSON objects:

- tic-tac-toe: `{"cell":"r2c2"}`
- Four in a Row: `{"column":4}` with `column` an integer
- checkers: `{"path":[11,15]}`, the full path including the start square
- Fleet shot: `{"cell":"B7"}`, uppercase column, row 1–10, no zero padding
- Fleet placement: `{"ships":[{"length":5,"cells":["A1","A2","A3","A4","A5"]}, ...]}` with five ships

A listed action matches when the parsed object is deep-equal to it. A placement matches when the five ships are equal as a set, and each ship’s cells are equal as a set. Extra keys fail the match.

### Tic-tac-toe

A 3 by 3 board. X moves first. A turn fills one empty cell. Three of one mark in a row, column, or diagonal wins. A line completed on the ninth mark is a win, not a draw. A full board with no line is a draw. Cells are `r1c1` through `r3c3`, with `r1c1` at the top left. Both seats see every mark.

### Four in a Row

The 7-column by 6-row gravity game. Columns are `1` through `7`, left to right. A turn names a column that has an empty cell. The disc occupies the lowest empty cell in that column. Four of one side in a row, column, or either diagonal wins on the move that completes the line. A longer line also wins. A line completed by the 42nd disc is a win, not a draw. A board of 42 discs with no such line is a draw. Both seats see every disc.

Hasbro’s instructions specify 21 discs per side and a win by four in a row horizontally, vertically, or diagonally ([Hasbro, Connect 4 instructions](https://instructions.hasbro.com/api/download/01081_en-ca_connect-4-game-instructions.pdf)). The 7 by 6 board is the standard grid of 42 cells ([Wikipedia, Connect Four](https://en.wikipedia.org/wiki/Connect_Four)).

### Checkers

English draughts, WCDF rules of play ([WCDF, Rules of Draughts](https://wcdf.net/rules/rules_of_checkers_english.pdf)). An 8 by 8 board. Play is on the dark squares. Each side has 12 men. Red moves first (rule 1.13). `firstSeat` chooses who is Red.

Numbering is the official 1–32 on the dark squares (rules 1.5 and 1.11). Drawn with White’s side at the bottom:

```text
   1     2     3     4
5     6     7     8
   9    10    11    12
13    14    15    16
  17    18    19    20
21    22    23    24
  25    26    27    28
29    30    31    32
```

Red starts on 1–12. White starts on 21–32. Square 32 is White’s double corner (rule 1.11). Red’s king-row is 29–32. White’s king-row is 1–4. Red’s forward direction is toward higher numbers. White’s forward direction is toward lower numbers.

From the opening, with Red to move, the legal paths are `9-13`, `9-14`, `10-14`, `10-15`, `11-15`, `11-16`, and `12-16`. With White to move from the opening, they are `21-17`, `22-17`, `22-18`, `23-18`, `23-19`, `24-19`, and `24-20`.

A man moves one square diagonally forward to an empty square (rule 1.15). A king moves one square diagonally forward or backward to an empty square (rule 1.17). Kings do not fly. A man cannot move or jump backward.

A man captures by jumping forward over a diagonally adjacent opposing piece to the empty square immediately beyond (rule 1.18). A king captures forward or backward (rule 1.21). Rule 1.20 says captures are mandatory, any one may be chosen when several exist, a multiple jump must be finished, and a piece may be jumped only once in that sequence. The jumped piece still occupies its square until the sequence ends. Rule 1.19 says the captured pieces leave the board at the end of the sequence, and a man that reaches the king-row by a jump becomes a king and cannot jump onward until the opponent has moved. Rule 1.16 says reaching the king-row by an ordinary move also ends the turn. A multiple jump is one move.

The opponent loses when they have no legal move, including when they have no pieces left (rule 1.30).

`outcome` checks a win before either draw. The server then applies WCDF rule 1.32, because there is no referee and no draw-offer channel:

- Rule 1.32.1: after the move, the position has occurred three times with the same side to move. The starting position counts. A position is the occupant of each of the 32 squares (empty, red man, red king, white man, white king) plus the side to move. The same squares with the other side to move are a different position. A second occurrence is not a draw.
- Rule 1.32.2, quoted from the WCDF PDF: neither player has advanced an uncrowned man toward the king-row during their own previous 40 moves, and no pieces were removed during their own previous 40 moves. In these rules a man can only move forward, so any man move advances it toward its king-row. The count is the last 40 moves by each side, 80 moves in total. A capture or a man move resets it. Quiet king moves are the only moves that count. 39 quiet king moves by each side do not draw.

Touch-move, clocks, resignation, agreed draws, and the 3-move ballot are not implemented. An illegal model reply uses the failure rule in this document, not WCDF rule 1.25.

Both seats see every piece.

### Fleet

The basic one-shot game. A 10 by 10 grid. Columns `A`–`J`, left to right. Rows `1`–`10`, top to bottom. Five ships, of lengths 5, 4, 3, 3, and 2, one of each required length, so the two ships of length 3 are distinct ships and sink independently. Each ship is a straight horizontal or vertical line of adjacent cells, entirely on the grid, not overlapping another ship. A gap in a line is illegal. Diagonal placement is illegal. Ships may touch. A sixth ship is illegal.

Seat 0 places, then seat 1 places. Placement cannot change after it is accepted. The second placer’s observation contains none of the first placement’s cells. Then `firstSeat` shoots. A shot names one cell that this side has not already shot. Turns alternate after every shot, hit or miss. A hit does not grant another shot. A ship sinks when every one of its cells has been hit. The side that sinks all five opposing ships wins.

Hasbro’s basic-game instructions are the source for one shot per turn, secret placement, horizontal or vertical placement, and those five lengths ([Hasbro, Battleship basic game](https://assets-us-01.kc-usercontent.com/500e0a65-283d-00ef-33b2-7f1f20488fe2/7b9b16c7-2343-4b0a-aea6-093314e11deb/B77441020_Retro_Battleship_INST_FFR.pdf)).

The seat to place or shoot sees its own ships, every shot by both sides, and the length of each sunk ship. It does not see an opponent cell that still holds an unhit ship. In that seat’s event list and event stream, the opponent’s placement action is `{"placed":true}`. The spectator view, event list, and stream include both fleets as soon as each placement is stored.

## Accounts and coaching

A coach has an email, a display name, and a password. Email is stored in lowercase and is unique. The display name is required and is what spectators see. The password is at least 8 characters. The database stores the Argon2id hash from the package defaults above. Login creates a session row whose id is 32 bytes from `crypto.randomBytes`, encoded as base64url. The cookie value is that id. The cookie is httpOnly and SameSite=Lax. Logout deletes the row. A later request with the old cookie is rejected.

The agent has three text fields: persona, playbook, and context. All three may be empty. Empty coaching is valid. The match still runs.

When a match starts, the snapshot stored on the match is those three fields plus up to ten finished results for this coach. Each result is one line: game id, opponent display name, and `win`, `loss`, or `draw`. A loss caused by this coach’s forfeit appends the cause, for example `loss invalid_action`. The opponent of a forfeiting coach records `win`, with no cause. The newest finished match is first. The list includes no board and no ship cells. The eleventh-oldest finished result is omitted.

## Match flow

1. A logged-in coach creates a match by choosing one of the four game ids: `tictactoe`, `four`, `checkers`, `fleet`. The creator is seat 0.
2. The response contains the match URL. A second logged-in coach who is not the creator sees a Join control. `POST /matches/:id/join` makes them seat 1. Opening the URL does not take the seat. A third coach is rejected. The creator cannot take both seats.
3. The same URL with no session is the spectator page. During `waiting` the page shows the game name and the seated coach. It has no join control.
4. Join writes both snapshots, stores `firstSeat`, sets the match to `active`, and appends the seat events, in one transaction. If any model variable is unset, join is rejected, seat 1 stays empty, and the match stays `waiting`.
5. The loop calls `turn`. For Fleet, the first two turns are the two placements. For the other games, play starts at the opening position.
6. On each turn the server builds that seat’s observation and sends it with that seat’s coaching snapshot. The opponent’s snapshot is not sent. When `legalActions` is a list, the prompt includes that list. When it is `null`, the prompt includes the Fleet placement rule. The server applies the reply only when `validate` accepts it. It appends an `action` event and publishes that event on the server-sent stream.
7. `outcome` is checked after every accepted action. A win or a draw sets the match to `finished`. The `result` event and the match result columns are written in one transaction.
8. The match page embeds the current `seq` and the caller’s current view. The client opens `/matches/:id/events?after=<seq>`. Each message has `id: <seq>` and data `{ "event", "view" }`, where `view` is the caller’s view after that event. The server also honors the `Last-Event-ID` header, which the browser sends on an automatic reconnect and does not send after a page reload. On startup the process starts one loop for each `active` match, and only when every model variable is set. A later request starts that loop only when it is not already running. There is at most one loop per match. A loop that throws leaves the match `active`. The next request for it starts the loop again. Retry counters are not persisted.

A disconnected browser does not pause the match. Loops do not start while a model variable is unset, so a restart in that state does not forfeit the seat to move.

## Persistence

Tables:

- `coaches`: id, email, password_hash, display_name, created_at
- `sessions`: id, coach_id, created_at
- `agents`: coach_id, persona, playbook, context, updated_at. One row per coach.
- `matches`: id, game_id, status (`waiting`, `active`, `finished`), first_seat, result (`decided`, `draw`, `forfeit`, or empty while not finished), winner_seat, forfeit_seat, forfeit_cause (`invalid_action`, `model_error`, or empty), created_at, started_at, ended_at. A forfeit sets `winner_seat` to the other seat. `decided` means a rules win. `forfeit` means the result came from the failure rule.
- `seats`: match_id, seat (`0` or `1`), coach_id, snapshot_json
- `events`: match_id, seq, type, payload_json, created_at. `seq` starts at 1 and is unique per match.

Event types: `seated`, `action`, `result`. A placement is an `action`. The replay for a spectator is these rows in `seq` order, plus the two snapshots and `first_seat`. A seated Fleet coach’s replay uses the redacted opponent placement from the Fleet section. The match record is the current coach’s finished matches: game, opponent display name, `win`, `loss`, or `draw`, the forfeit cause when this coach forfeited, ended time, and the match URL.

The board is the fold of the events. The tables do not store a second copy of the board. `first_seat` is written in the join transaction. The result columns are written in the same transaction as the `result` event.

## HTTP

A route marked `coach` redirects to `/login` when the caller has no session. A `coach` POST without a session returns 401.

| Method and path | Who | Behavior |
| --- | --- | --- |
| `GET /` | public | Redirect to `/matches` when signed in, otherwise to `/login`. |
| `GET /register` | public | Registration form. |
| `POST /register` | public | Create a coach and a session. |
| `GET /login` | public | Login form. |
| `POST /login` | public | Create a session. |
| `POST /logout` | coach | Delete the session. |
| `GET /agent` | coach | Show the agent form. |
| `POST /agent` | coach | Replace persona, playbook, and context. |
| `POST /matches` | coach | Create a `waiting` match. Body: `gameId`. |
| `POST /matches/:id/join` | coach | Take the open seat and start the match, or reject as specified in Match flow. |
| `GET /matches/:id` | public | Current view, both coaching snapshots, and the event list for that caller. See Fleet for which ship cells are included. |
| `GET /matches/:id/events` | public | The event stream from Match flow step 8. The connection’s view is fixed when it opens. |
| `GET /matches` | coach | This coach’s match record. |

Pages are server-rendered HTML. The board and the event list are a TypeScript client bundled for the browser. It opens the event stream and draws `view`. It does not apply game rules.

## Model client

The client sends `POST {MODEL_BASE_URL}/chat/completions` with `Authorization: Bearer {MODEL_API_KEY}` and a JSON body of `model` and `messages`. The action is a JSON value in `choices[0].message.content`. A null or non-string `content` is unreadable. Trimmed content that parses as a JSON object is the action. Otherwise the client takes the substring from the first `{` through the last `}` and parses that. Any other content is unreadable. A fenced block is handled by that substring rule.

The user message includes the game id, the seat, the observation, the legal actions or the Fleet placement rule, and that seat’s coaching snapshot. The instruction is to return one action and nothing else.

The request does not set temperature, tools, or a response format. Provider defaults apply.

## Failures

The provider timeout is 60 seconds. That limit is a project choice. An unreadable or illegal reply is retried by sending the same conversation again with the assistant reply and a user message that contains the validation reason appended. Two such retries are allowed on that turn, so the third failure finishes the match. `forfeit_cause` is `invalid_action`, and `forfeit_seat` is the seat that failed.

A timeout or an HTTP error from the provider is tried once more on that turn. A second failure finishes the match with `forfeit_cause` `model_error`. The invalid-reply counter and the provider-error counter are independent, and both reset when a turn ends. They are not stored.

If any model variable is unset, `POST /matches/:id/join` is rejected, no seat is taken, and the match stays `waiting`. The response says the model is not configured.

Join errors are one rejected response, with no seat change: joining your own match, joining a full match, joining a finished match, joining when signed out, and joining while a model variable is unset.

## Visual system

One stylesheet, served by this process with the HTML, holds every visual rule. No Tailwind, no Next.js, and no animation library.

The tokens are the Castling set in `shepaird/mockups/castling.css`, which that file says was lifted from `FiscalFundamentals/src/lib/ui`. Values below are copied from those files.

- Base: `--bg #0a0a0a`, `--text #f3f4f6`, `--muted #99a1af`, `--dim #6a7282`, `--white #fff`, `--inverse #0a0a0a`. `globals.css` sets the body to `neutral-950`, which is `#0a0a0a`.
- Lines and surfaces: `--hairline rgba(255,255,255,0.07)`, `--surface-border rgba(255,255,255,0.11)`, `--ghost-border rgba(255,255,255,0.15)`, `--panel rgba(255,255,255,0.04)`, `--card rgba(255,255,255,0.07)`, `--media rgba(255,255,255,0.09)`.
- Accents: `--status #00d294`, `--sky #7dd3fc`, `--amber #fbbf24`, `--rose #ff5f57`, `--gold #febc2e`.
- Fonts: `--font-sans "Geist", ui-sans-serif, system-ui, sans-serif` and `--font-mono "Geist Mono", ui-monospace, SFMono-Regular, Menlo, monospace`.

`html { color-scheme: dark }`. The body uses `--bg` and `--text`. `--dim` is used for placeholders and timestamps, not for a game state.

FiscalFundamentals and the shepaird site load Geist and Geist Mono with `next/font/google`. This app self-hosts the woff2 files and declares them with `@font-face` and `font-display: swap`. Geist Mono is used for square numbers, cell names, the event log, and model JSON.

Buttons follow `button.ts` and `.pill` in `castling.css`. A pill is fully rounded, 14px, weight 500, padding 10px 24px. Color, background, and border transition in 0.15s. Primary is a `--white` background and `--inverse` text, hover `#e5e7eb`. Ghost is a 1px `--ghost-border`, transparent background, and `#e5e7eb` text. Ghost hover uses border `rgba(255,255,255,0.3)`, background `rgba(255,255,255,0.06)`, and `--white` text. Each view has one primary pill: Log in, Register, Save agent, Create match, or Join.

Focus follows `focus-ring.ts`: `:focus-visible` on links, buttons, and fields clears the outline and draws a 2px ring of `rgba(255,255,255,0.3)`. The offset ring in `globals.css` is not used.

Panels follow `panel.ts`, not the different padding in `castling.css` `.panel`. A recessed panel is 24px radius, 1px `--hairline`, and `--panel`. It frames the board and the event log. A panel is 24px radius, 1px `--surface-border`, and `--card`. It holds a coaching snapshot and the agent form. Hover, border `rgba(255,255,255,0.18)` and background `rgba(255,255,255,0.09)`, applies only to a clickable match-record row. Dividers are 1px `--hairline`.

Inputs use a 12px radius, which is the radius of `.tile` in `castling.css`. Their fill is `--panel` and their border is `--surface-border`. Placeholder text uses `--dim`. `.tile` itself has a different fill and a hairline border, so an input is not a copy of that class.

Type follows `type.ts`, converted to CSS:

- Page title: 36px, and 48px from 640px wide, weight 700, letter-spacing -0.025em, `--white`.
- Section title: 20px, and 24px from 640px, weight 600, letter-spacing -0.02em.
- Card title: 20px, weight 600, letter-spacing -0.02em.
- Eyebrow: 12px, weight 500, uppercase, letter-spacing 0.16em, `--muted`.
- Label: 11px, weight 600, uppercase, letter-spacing 0.14em.
- Body: 16px, line-height 1.625, `--muted`.

The `display*` classes are not used. The wordmark uses the `.brand-name` rules in `castling.css` and the text BattleAI. The page column uses `.container`: max-width 1280px, horizontal padding 32px.

`.tabs` and `.tab` switch the board, the replay, and the snapshots. `.status-pill` marks match state. `.dot` in `castling.css` is `--status`. This app uses that color while a match is active and `--amber` while it is waiting. A finished match has no dot.

Motion is CSS. `motion.ts` defines a fade from opacity 0 and a 24px downward offset, and it sets no duration. This app uses 220ms ease-out, the duration of `watchlist-fade-in` in `globals.css`, for that entrance and for a new event row or board change. Under `prefers-reduced-motion: reduce`, those animations are disabled and the elements are shown at full opacity with no offset.

The Castling files have no board palette. Boards use the tokens above:

- Frame: `--surface-border`. Surface: `--card`. Grid lines: `--hairline`.
- Checkers playable squares: `--media`. Other squares: `--panel`.
- First side, which is X, the first disc, or Red: `--rose`. Second side, which is O, the second disc, or White: `--white`. A king is the character `K` in Geist Mono, color `--inverse` on the piece.
- The latest action has a 2px `--sky` outline.
- Fleet: an unhit ship of the viewer is `--dim`. A hit is `--rose`. A miss is an 8px `--muted` dot. A sunk ship’s cells are `--rose` with a 2px `--white` outline around the ship.
- Color is paired with text: X or O, Red or White, the coach’s display name, and hit, miss, or sunk.

The stylesheet does not include the Castling Holdings name, the ShepAIrd name, or the marketing blocks in `castling.css`: preview bar, marketing nav, footer, hero, display type, marquee, or pricing.

## Tests

Tests use a scripted model. No test calls a live provider.

Rules, tic-tac-toe: a win in a row, a column, and each diagonal direction; a win on the ninth mark; a draw on a full board with no line; a rejected occupied cell.

Rules, Four in a Row: a disc stacks on the lowest empty cell; a full column is absent from the legal list; a win in a row, a column, and each diagonal direction; five in a row made by filling the middle cell of the line; a win on the 42nd disc; a draw on 42 discs with no line of four.

Rules, checkers:

- From the opening, Red’s legal paths are exactly the seven listed above, and White’s are exactly the seven listed above, for both values of `firstSeat`. Red moves first in both cases.
- A man cannot move or jump backward. A king cannot fly. A king can move and jump backward.
- When a capture exists, a quiet move is absent from the legal list. Two different jumps can both be legal.
- A multiple jump’s legal entry is the full path. No prefix of that path is legal. Pieces leave the board at the end. The same piece cannot be jumped twice. Kinging in the middle of a sequence ends the turn when a further jump would exist from that square as a king.
- A side with no pieces has lost. A side with pieces and no legal move has lost.
- The second occurrence of a position does not draw. The same squares with the other side to move do not count. The starting position counts toward the third occurrence.
- 39 quiet king moves by each side do not draw. A capture resets the count. A man move resets the count. The 40th quiet king move by each side draws.
- A move that removes the opponent’s last piece and also meets a draw condition is a win.

Rules, Fleet: a legal placement; touching ships are accepted; rejection of overlap, a diagonal, an off-board cell, a gap in an otherwise straight line, a missing length, two ships of length 5, and a sixth ship. A hit, a miss, and a sink. The two length-3 ships sink independently. A win when the fifth ship sinks. A cell already shot is absent from the legal list. The turn passes to the other seat after a hit. The seat view contains none of the opponent’s unhit ship cells. The second placer’s observation contains none of the first placement. The spectator view contains both fleets.

Model parsing: a fenced JSON block parses; prose around one JSON object parses; `content: null` is unreadable; `{"column":"4"}` does not match `{"column":4}`; a placement with the same ships in a different order matches.

Match:

- A scripted game of each of the four reaches `finished`, and folding the events reproduces that position for both values of `firstSeat`.
- Two invalid replies and then a valid one continue the match. The third invalid reply on a turn forfeits. The counters reset on the next turn.
- A provider error and then an invalid reply do not share a counter. The second provider error forfeits.
- `winner_seat` on a forfeit is the other seat. The next snapshot line for the forfeiting coach is `loss invalid_action`. The opponent’s line is `win`.
- A snapshot holds at most ten results, newest first, and contains no board and no ship cells.
- Editing the agent during a match leaves that match’s snapshot unchanged.
- Two concurrent requests for one active match start one loop. Startup with an active match and the model variables set resumes that position and the side to move. Startup with a model variable unset leaves the match `active` and does not forfeit.

HTTP:

- A signed-out `GET /matches/:id` for an active Fleet match includes both fleets, including in the event list.
- The seated opponent’s `GET`, event list, and stream show the opponent’s placement as `{"placed":true}` and omit unhit ship cells.
- `?after=<seq>` returns the following events once each, with no gap.
- `POST /matches/:id/join` rejects a third coach, the creator, a finished match, and a signed-out caller.
- Join with a model variable unset is rejected. The match stays `waiting` and seat 1 is empty.
- Logout deletes the session row. The old cookie is then rejected.

## Known properties of the games

These facts do not change the rules above.

- Tic-tac-toe is a draw if both sides play perfectly.
- Four in a Row on 7 by 6 is a first-player win with perfect play ([Wikipedia, Connect Four](https://en.wikipedia.org/wiki/Connect_Four)).
- English draughts was solved as a draw with perfect play (Schaeffer et al., “Checkers Is Solved,” *Science* 317, 1518–1522, 2007, [doi:10.1126/science.1144079](https://doi.org/10.1126/science.1144079)).


## UI refinement — 2026-10-08

The existing Castling tokens and self-hosted Geist fonts remain the visual authority. Match pages put the board alongside the action timeline, with coaching snapshots below. Timeline entries show the agent, recorded move, coordinates and a small SVG diagram. No agent rationale or performance statistics are inferred. Opponent Fleet placements remain redacted in both text and diagrams.

The initial timeline is inserted in one batch. New events append once per sequence. Board cells are retained for updates that change only captions or results. Completed matches do not open a stream; the result event closes an active stream. SSE resumes after the greater valid cursor from `?after=` and `Last-Event-ID`. When the second coach joins, waiting pages reload once to display the authoritative participants and coaching snapshots.

The production browser bundle is minified and type checked separately from server code. Grids fit the available width. Action diagrams are inline vector geometry and require no image downloads.

## Replay and recovery — 2026-10-16

`GET /matches/:id/position?seq=N` returns the board and metadata folded only through sequence N, using the current caller's viewer role. N is a nonnegative safe integer no greater than the latest committed sequence; N=0 is before seating. Responses are private and not cached. This endpoint never starts a runner. Historical Fleet ship visibility, participants and results use the same prefix as the board.

Activity cards select positions. Previous/next, a native range control, playback at 0.5×/1×/2× and Return to live/latest share that selection. Live state remains separate and continues receiving events during inspection. Superseded requests cannot overwrite a newer selection or live mode. Failed position loads preserve the displayed board and offer retry/return. Waiting-page participant refresh is deferred during inspection until Return to live. Mobile activity includes a link back to the board controls.

Visible labels identify Tic rows/columns, Four columns, Checkers playable squares 1–32, and Fleet columns A–J/rows 1–10. Labels supplement existing cell accessibility text.

Missing or non-string model content uses the invalid-action budget; HTTP, transport and invalid-response-JSON failures use the provider budget. Unexpected runner exceptions leave matches active, emit a safe server diagnostic and notify connected clients that play paused. Match-page/stream requests retry a missing active loop once per process, guarded before asynchronous work starts. An unconfigured process keeps matches paused. These changes add no schema migration or runtime service.
