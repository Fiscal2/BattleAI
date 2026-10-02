type Seat = 0 | 1;
type Outcome = "ongoing" | { winner: Seat } | "draw";

type Boot = {
  matchId: string;
  seq: number;
  view: View | null;
  names: Record<string, string>;
  game: string;
};

type View =
  | {
      game: "tictactoe";
      cells: Array<"X" | "O" | null>;
      turn: Seat | null;
      lastCell: string | null;
      outcome: Outcome;
    }
  | {
      game: "four";
      grid: Array<Array<"A" | "B" | null>>;
      turn: Seat | null;
      last: { column: number; row: number } | null;
      outcome: Outcome;
    }
  | {
      game: "checkers";
      pieces: Record<string, "red-man" | "red-king" | "white-man" | "white-king">;
      turn: Seat | null;
      lastPath: number[] | null;
      outcome: Outcome;
    }
  | {
      game: "fleet";
      phase: "place" | "shoot" | "done";
      turn: Seat | null;
      ships: Array<{ seat: Seat; length: number; cells: string[]; sunk: boolean }>;
      shots: Array<{ seat: Seat; cell: string; hit: boolean }>;
      lastShot: { seat: Seat; cell: string } | null;
      outcome: Outcome;
    };

type ShownEvent = { seq: number; type: string; payload: Record<string, unknown> };

const boot = JSON.parse(document.querySelector<HTMLScriptElement>("#boot")!.textContent || "{}") as Boot;
const board = document.querySelector<HTMLElement>("#board")!;
const events = document.querySelector<HTMLOListElement>("#events")!;
const seen = new Set<number>();

declare global {
  interface Window {
    __events?: ShownEvent[];
  }
}

for (const event of window.__events ?? []) addEvent(event);
if (boot.view) render(boot.view);
else board.innerHTML = `<p class="waiting">Waiting for the second coach.</p>`;

const source = new EventSource(`/matches/${boot.matchId}/events?after=${boot.seq}`);
source.onmessage = (message) => {
  const data = JSON.parse(message.data) as { event: ShownEvent; view: View | null };
  addEvent(data.event);
  if (data.view) render(data.view);
  const status = document.querySelector(".status-pill");
  if (status && data.view && data.view.outcome !== "ongoing") {
    status.textContent = data.view.outcome === "draw" ? "draw" : "finished";
  }
};

function addEvent(event: ShownEvent) {
  if (seen.has(event.seq)) return;
  seen.add(event.seq);
  const item = document.createElement("li");
  item.textContent = `${event.seq}. ${event.type} ${JSON.stringify(event.payload)}`;
  events.append(item);
}

function render(view: View) {
  board.replaceChildren();
  if (view.game === "tictactoe") renderTic(view);
  else if (view.game === "four") renderFour(view);
  else if (view.game === "checkers") renderCheckers(view);
  else renderFleet(view);
  const label = document.createElement("p");
  label.className = "turn-label";
  label.textContent = caption(view);
  board.append(label);
}

function caption(view: View): string {
  if (view.outcome === "draw") return "Draw";
  if (view.outcome !== "ongoing") return `${name(view.outcome.winner)} wins`;
  if (view.turn === null) return "Finished";
  return `${name(view.turn)} to move`;
}

function name(seat: Seat): string {
  return boot.names[String(seat)] || `Seat ${seat}`;
}

function renderTic(view: Extract<View, { game: "tictactoe" }>) {
  const grid = document.createElement("div");
  grid.className = "grid tic";
  view.cells.forEach((mark, index) => {
    const cell = document.createElement("div");
    const id = `r${Math.floor(index / 3) + 1}c${(index % 3) + 1}`;
    cell.className = `square${id === view.lastCell ? " last" : ""}`;
    cell.textContent = mark ?? "";
    if (mark === "X") cell.classList.add("side-a");
    if (mark === "O") cell.classList.add("side-b");
    grid.append(cell);
  });
  board.append(grid);
}

function renderFour(view: Extract<View, { game: "four" }>) {
  const grid = document.createElement("div");
  grid.className = "grid four";
  for (let row = view.grid.length - 1; row >= 0; row -= 1) {
    for (let column = 0; column < 7; column += 1) {
      const mark = view.grid[row]?.[column] ?? null;
      const cell = document.createElement("div");
      cell.className = "square";
      if (view.last && view.last.row === row && view.last.column === column + 1) cell.classList.add("last");
      if (mark) {
        const disc = document.createElement("span");
        disc.className = mark === "A" ? "disc side-a" : "disc side-b";
        disc.textContent = mark === "A" ? "A" : "B";
        cell.append(disc);
      }
      grid.append(cell);
    }
  }
  board.append(grid);
}

function renderCheckers(view: Extract<View, { game: "checkers" }>) {
  const grid = document.createElement("div");
  grid.className = "grid checkers";
  const at = new Map<string, number>();
  for (let n = 1; n <= 32; n += 1) {
    const index = n - 1;
    const row = Math.floor(index / 4);
    const pos = index % 4;
    const col = row % 2 === 0 ? pos * 2 + 1 : pos * 2;
    at.set(`${row},${col}`, n);
  }
  for (let row = 0; row < 8; row += 1) {
    for (let col = 0; col < 8; col += 1) {
      const cell = document.createElement("div");
      const square = at.get(`${row},${col}`);
      cell.className = square ? "square playable" : "square light";
      if (square && view.lastPath?.includes(square)) cell.classList.add("last");
      const piece = square ? view.pieces[String(square)] : undefined;
      if (piece) {
        const token = document.createElement("span");
        token.className = piece.startsWith("red") ? "piece side-a" : "piece side-b";
        token.textContent = piece.endsWith("king") ? "K" : piece.startsWith("red") ? "R" : "W";
        cell.append(token);
      }
      grid.append(cell);
    }
  }
  board.append(grid);
}

function renderFleet(view: Extract<View, { game: "fleet" }>) {
  const oceans = document.createElement("div");
  oceans.className = "oceans";
  for (const seat of [0, 1] as const) {
    const ocean = document.createElement("div");
    const title = document.createElement("p");
    title.className = "ocean-label";
    title.textContent = name(seat);
    ocean.append(title, fleetGrid(view, seat));
    oceans.append(ocean);
  }
  board.append(oceans);
}

function fleetGrid(view: Extract<View, { game: "fleet" }>, seat: Seat): HTMLElement {
  const columns = "ABCDEFGHIJ".split("");
  const grid = document.createElement("div");
  grid.className = "grid fleet";
  const ships = new Map<string, { sunk: boolean }>();
  for (const ship of view.ships) {
    if (ship.seat !== seat) continue;
    for (const cell of ship.cells) ships.set(cell, { sunk: ship.sunk });
  }
  const shots = new Map(
    view.shots.filter((shot) => shot.seat !== seat).map((shot) => [shot.cell, shot]),
  );
  for (let row = 1; row <= 10; row += 1) {
    for (const column of columns) {
      const id = `${column}${row}`;
      const cell = document.createElement("div");
      cell.className = "square";
      const ship = ships.get(id);
      const shot = shots.get(id);
      if (view.lastShot?.cell === id && view.lastShot.seat !== seat) cell.classList.add("last");
      if (ship && !shot) cell.classList.add("ship");
      if (shot?.hit || ship?.sunk) cell.classList.add("hit");
      if (ship?.sunk) cell.classList.add("sunk");
      if (shot && !shot.hit) cell.classList.add("miss");
      cell.textContent = shot ? (shot.hit ? "hit" : "miss") : ship ? "ship" : "";
      grid.append(cell);
    }
  }
  return grid;
}
