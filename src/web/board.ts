import { resultText } from "./feed.js";
import { agentName, isSeat, type FeedContext, type MatchResult, type Seat, type View } from "./types.js";

export function boardCaption(view: View | null, context: FeedContext, result?: MatchResult | null, finished = false): string {
  if (result) {
    const text = resultText(result, context.names);
    return [text.title, text.detail].filter(Boolean).join(". ");
  }
  if (view?.outcome === "draw") return "Draw";
  if (view && view.outcome !== "ongoing") return `${agentName(context.names, view.outcome.winner)} wins`;
  if (finished) return "Match finished";
  if (!view) return "Waiting for the second coach.";
  if (view.turn === null) return "Finished";
  return `${agentName(context.names, view.turn)} ${view.game === "fleet" && view.phase === "place" ? "to place the fleet" : "to move"}`;
}

export function createBoardRenderer(board: HTMLElement, context: FeedContext) {
  const document = board.ownerDocument;
  const surface = document.createElement("div");
  surface.className = "board-surface";
  surface.style.minWidth = "0";
  const caption = document.createElement("p");
  caption.className = "board-caption turn-label";
  caption.setAttribute("role", "status");
  const legend = document.createElement("div");
  legend.className = "board-legend";
  board.replaceChildren(surface, caption, legend);
  let lastBoard = "";
  let lastLegend = "";

  const seatClass = (first: boolean) => isSeat(context.firstSeat)
    ? ` seat-${first ? context.firstSeat : 1 - context.firstSeat}` : "";
  const pieceLabel = (piece: string, first: boolean) => isSeat(context.firstSeat)
    ? `${piece}, ${agentName(context.names, (first ? context.firstSeat : 1 - context.firstSeat) as Seat)}` : piece;
  const grid = (className: string, columns: number, maxWidth: number, label: string) => {
    const node = document.createElement("div");
    node.className = `grid ${className}`;
    node.style.gridTemplateColumns = `repeat(${columns}, minmax(0, 1fr))`;
    node.style.width = "100%";
    node.style.maxWidth = `${maxWidth}px`;
    node.setAttribute("role", "group");
    node.setAttribute("aria-label", label);
    return node;
  };
  const square = (label: string, className = "square") => {
    const cell = document.createElement("div");
    cell.className = className;
    cell.style.minWidth = "0";
    cell.style.minHeight = "0";
    cell.style.aspectRatio = "1";
    cell.setAttribute("role", "img");
    cell.setAttribute("aria-label", label);
    return cell;
  };
  const disc = (className: string, text: string) => {
    const node = document.createElement("span");
    node.className = className;
    node.textContent = text;
    node.style.maxWidth = "75%";
    node.style.maxHeight = "75%";
    return node;
  };

  function renderSurface(view: View) {
    if (view.game === "tictactoe") {
      const node = grid("tic", 3, 270, "Tic-tac-toe board");
      view.cells.forEach((mark, index) => {
        const id = `r${Math.floor(index / 3) + 1}c${index % 3 + 1}`;
        const cell = square(`${id}: ${mark ? pieceLabel(mark, mark === "X") : "empty"}`);
        cell.textContent = mark ?? "";
        if (mark) cell.className += `${mark === "X" ? " side-a" : " side-b"}${seatClass(mark === "X")}`;
        if (id === view.lastCell) cell.classList.add("last");
        node.append(cell);
      });
      surface.replaceChildren(node);
    } else if (view.game === "four") {
      const node = grid("four", 7, 380, "Four-in-a-row board; row 1 is the bottom row");
      for (let row = view.grid.length - 1; row >= 0; row -= 1) {
        for (let column = 0; column < 7; column += 1) {
          const mark = view.grid[row]?.[column] ?? null;
          const cell = square(`Column ${column + 1}, row ${row + 1}: ${mark ? pieceLabel(`${mark} disc`, mark === "A") : "empty"}`);
          if (mark) cell.append(disc(`disc ${mark === "A" ? "side-a" : "side-b"}${seatClass(mark === "A")}`, mark));
          if (view.last?.row === row && view.last.column === column + 1) cell.classList.add("last");
          node.append(cell);
        }
      }
      surface.replaceChildren(node);
    } else if (view.game === "checkers") {
      const node = grid("checkers", 8, 380, "Checkers board");
      for (let row = 0; row < 8; row += 1) {
        for (let column = 0; column < 8; column += 1) {
          const playable = (row + column) % 2 === 1;
          const number = playable ? row * 4 + Math.floor(column / 2) + 1 : null;
          const piece = number === null ? undefined : view.pieces[String(number)];
          const coordinate = `Row ${row + 1}, column ${column + 1}${number === null ? "" : `, square ${number}`}`;
          const state = piece ? pieceLabel(piece.replace("-", " "), piece.startsWith("red")) : playable ? "empty" : "unplayable";
          const cell = square(`${coordinate}: ${state}`, `square ${playable ? "playable" : "light"}`);
          if (piece) cell.append(disc(`piece ${piece.startsWith("red") ? "side-a" : "side-b"}${seatClass(piece.startsWith("red"))}`,
            piece.endsWith("king") ? "K" : piece.startsWith("red") ? "R" : "W"));
          if (number !== null && view.lastPath?.includes(number)) cell.classList.add("last");
          node.append(cell);
        }
      }
      surface.replaceChildren(node);
    } else {
      const oceans = document.createElement("div");
      oceans.className = "oceans";
      for (const seat of [0, 1] as const) {
        const ocean = document.createElement("div");
        ocean.style.width = "100%";
        ocean.style.maxWidth = "356px";
        const title = document.createElement("p");
        title.className = `ocean-label seat-${seat}`;
        title.textContent = agentName(context.names, seat);
        const node = grid("fleet", 10, 356, `${title.textContent}'s ocean`);
        const ships = new Map(view.ships.filter((ship) => ship.seat === seat).flatMap((ship) => ship.cells.map((cell) => [cell, ship] as const)));
        const shots = new Map(view.shots.filter((shot) => shot.seat !== seat).map((shot) => [shot.cell, shot]));
        for (let row = 1; row <= 10; row += 1) {
          for (const column of "ABCDEFGHIJ") {
            const id = `${column}${row}`;
            const ship = ships.get(id);
            const shot = shots.get(id);
            const state = [shot ? shot.hit ? "hit" : "miss" : "unshot", ship ? ship.sunk ? "sunk ship" : "ship" : "no ship revealed"].join(", ");
            const cell = square(`${title.textContent}, ${id}: ${state}`);
            if (ship && !shot) cell.classList.add("ship");
            if (ship?.sunk) cell.classList.add("sunk");
            if (shot) cell.classList.add(shot.hit ? "hit" : "miss");
            if (view.lastShot?.cell === id && view.lastShot.seat !== seat) cell.classList.add("last");
            cell.textContent = shot ? shot.hit ? "hit" : "miss" : ship ? "ship" : "";
            node.append(cell);
          }
        }
        ocean.append(title, node);
        oceans.append(ocean);
      }
      surface.replaceChildren(oceans);
    }
  }

  return (view: View | null, result?: MatchResult | null, finished = false) => {
    // Turn/outcome-only messages update the caption without replacing board cells.
    const boardState = view?.game === "tictactoe" ? [view.cells, view.lastCell]
      : view?.game === "four" ? [view.grid, view.last]
      : view?.game === "checkers" ? [view.pieces, view.lastPath]
      : view?.game === "fleet" ? [view.ships, view.shots, view.lastShot] : null;
    const key = JSON.stringify([view?.game, boardState, context.firstSeat, context.names]);
    if (key !== lastBoard) {
      if (view) renderSurface(view);
      else {
        const preview = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        preview.setAttribute("class", "waiting-board");
        preview.setAttribute("viewBox", "0 0 100 100");
        preview.setAttribute("width", "120");
        preview.setAttribute("height", "120");
        preview.setAttribute("aria-hidden", "true");
        const lines = document.createElementNS("http://www.w3.org/2000/svg", "path");
        lines.setAttribute("d", "M8 8H92V92H8Z M36 8V92 M64 8V92 M8 36H92 M8 64H92");
        lines.setAttribute("fill", "none");
        lines.setAttribute("stroke", "currentColor");
        lines.setAttribute("opacity", ".25");
        preview.append(lines);
        surface.replaceChildren(preview);
      }
      lastBoard = key;
    }
    const text = boardCaption(view, context, result, finished);
    if (caption.textContent !== text) caption.textContent = text;
    const legendKey = JSON.stringify([view?.game, context.firstSeat, context.names]);
    if (lastLegend !== legendKey) {
      legend.replaceChildren();
      if (view) for (const seat of [0, 1] as const) {
        const entry = document.createElement("span");
        entry.className = `seat-${seat}`;
        const dot = document.createElement("span");
        dot.className = `legend-dot seat-${seat}`;
        dot.setAttribute("aria-hidden", "true");
        const label = document.createElement("span");
        const first = seat === context.firstSeat;
        const symbol = !isSeat(context.firstSeat) ? "" : view.game === "tictactoe" ? first ? "X" : "O"
          : view.game === "four" ? first ? "A" : "B" : view.game === "checkers" ? first ? "red" : "white" : "";
        label.textContent = `${agentName(context.names, seat)}${symbol ? ` · ${symbol}` : ""}`;
        entry.append(dot, label);
        legend.append(entry);
      }
      lastLegend = legendKey;
    }
  };
}
