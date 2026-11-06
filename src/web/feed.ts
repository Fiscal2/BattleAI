import { agentName, isSeat, type FeedContext, type Seat, type ShownEvent } from "./types.js";

type Graphic =
  | { kind: "tic"; cell: string; mark: "X" | "O" | null }
  | { kind: "four"; column: number }
  | { kind: "checkers"; path: number[] }
  | { kind: "fleet"; cells: string[]; target: boolean };

export type FormattedEvent = {
  seat: Seat | null;
  agent: string;
  kind: string;
  title: string;
  detail: string;
  coordinates: string[];
  graphic: Graphic | null;
};

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function resultText(payload: Record<string, unknown>, names: Record<string, string>) {
  const winner = isSeat(payload.winnerSeat) ? agentName(names, payload.winnerSeat) : null;
  if (payload.result === "draw") return { title: "Draw", detail: "The match ended in a draw." };
  if (payload.result === "forfeit") {
    const loser = isSeat(payload.forfeitSeat) ? agentName(names, payload.forfeitSeat) : null;
    const cause = payload.forfeitCause === "invalid_action" ? "invalid actions"
      : payload.forfeitCause === "model_error" ? "model errors" : null;
    return {
      title: winner ? `${winner} wins by forfeit` : "Match ended by forfeit",
      detail: `${loser ? `${loser} forfeited` : "Forfeit"}${cause ? ` after ${cause}` : ""}.`,
    };
  }
  return { title: winner ? `${winner} wins` : "Match finished", detail: "" };
}

export function formatEvent(event: ShownEvent, context: FeedContext): FormattedEvent {
  const payload = event.payload;
  const seat = isSeat(payload.seat) ? payload.seat : null;
  const formatted: FormattedEvent = {
    seat,
    agent: seat === null ? "Match" : agentName(context.names, seat),
    kind: event.type === "action" ? "Action" : event.type === "seated" ? "Seat" : event.type === "result" ? "Result" : "Event",
    title: "Event recorded",
    detail: "",
    coordinates: [],
    graphic: null,
  };
  if (event.type === "seated") {
    if (typeof payload.displayName === "string" && payload.displayName) formatted.agent = payload.displayName;
    formatted.title = "Joined the match";
    return formatted;
  }
  if (event.type === "result") {
    const winner = isSeat(payload.winnerSeat) ? payload.winnerSeat : null;
    return { ...formatted, ...resultText(payload, context.names), seat: winner,
      agent: winner === null ? "Match" : agentName(context.names, winner) };
  }
  if (event.type !== "action") return formatted;
  formatted.title = "Action recorded";
  const action = record(payload.action);
  if (context.game === "tictactoe" && typeof action.cell === "string" && /^r[1-3]c[1-3]$/.test(action.cell)) {
    const mark = seat !== null && isSeat(context.firstSeat) ? (seat === context.firstSeat ? "X" : "O") : null;
    formatted.title = mark ? `Placed ${mark}` : "Marked a cell";
    formatted.coordinates = [action.cell];
    formatted.graphic = { kind: "tic", cell: action.cell, mark };
  } else if (context.game === "four" && Number.isInteger(action.column) && Number(action.column) >= 1 && Number(action.column) <= 7) {
    formatted.title = "Dropped a disc";
    formatted.coordinates = [`Column ${action.column}`];
    formatted.graphic = { kind: "four", column: Number(action.column) };
  } else if (context.game === "checkers" && Array.isArray(action.path) && action.path.length >= 2
    && action.path.every((square) => Number.isInteger(square) && square >= 1 && square <= 32)) {
    const path = action.path as number[];
    const captured = event.consequence?.captured;
    formatted.title = captured !== undefined && captured > 0
      ? `Captured ${captured} ${captured === 1 ? "piece" : "pieces"}` : "Moved a piece";
    formatted.coordinates = path.map(String);
    formatted.detail = event.consequence?.promoted ? "Promoted to king" : "Path";
    formatted.graphic = { kind: "checkers", path };
  } else if (context.game === "fleet") {
    if (action.placed === true || Array.isArray(action.ships)) {
      formatted.title = "Placed the fleet";
      const ships = Array.isArray(action.ships) ? action.ships.map(record) : [];
      // Only explicit, valid placement cells can be drawn. Never recover a redacted placement from the view.
      const visible = action.placed !== true && ships.length > 0 && ships.every((ship) =>
        Array.isArray(ship.cells) && ship.cells.length > 0
        && ship.cells.every((cell) => typeof cell === "string" && /^[A-J]([1-9]|10)$/.test(cell)));
      if (visible) {
        const cells = ships.flatMap((ship) => ship.cells as string[]);
        formatted.detail = "Ship cells";
        formatted.coordinates = ships.map((ship) => {
          const cells = [...ship.cells as string[]].sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)) || a.localeCompare(b));
          return `${cells.length} cells · ${cells[0]}${cells.length > 1 ? `–${cells.at(-1)}` : ""}`;
        });
        formatted.graphic = { kind: "fleet", cells, target: false };
      } else formatted.detail = "Placement hidden.";
    } else if (typeof action.cell === "string" && /^[A-J]([1-9]|10)$/.test(action.cell)) {
      if (event.consequence !== undefined) {
        const { hit, sunkLength } = event.consequence;
        formatted.title = sunkLength !== undefined && sunkLength > 0 ? `Sank a ${sunkLength}-cell ship`
          : hit === true ? "Shot hit" : hit === false ? "Shot missed" : "Fired a shot";
      } else {
        const shot = context.view?.game === "fleet" ? context.view.shots.find((candidate) =>
          candidate.seat === seat && candidate.cell === action.cell) : undefined;
        formatted.title = shot ? (shot.hit ? "Shot hit" : "Shot missed") : "Fired a shot";
      }
      formatted.coordinates = [action.cell];
      formatted.graphic = { kind: "fleet", cells: [action.cell], target: true };
    }
  }
  return formatted;
}

export function eventCard(document: Document, event: ShownEvent, context: FeedContext, onSelect?: (seq: number) => void): HTMLLIElement {
  const formatted = formatEvent(event, context);
  const element = (tag: string, className: string, text = "") => {
    const node = document.createElement(tag);
    node.className = className;
    node.textContent = text;
    return node;
  };
  const item = document.createElement("li");
  item.className = `event-item${event.type === "result" ? " event-result" : ""}${formatted.seat === null ? "" : ` seat-${formatted.seat}`}`;
  item.dataset.seq = String(event.seq);
  const marker = element("span", "event-marker");
  marker.setAttribute("aria-hidden", "true");
  const content = element(onSelect ? "span" : "div", "event-content");
  const meta = element(onSelect ? "span" : "div", "event-meta");
  meta.append(element("span", "event-agent", formatted.agent), element("span", "event-kind", formatted.kind),
    element("span", "event-seq", `#${event.seq}`));
  const title = element(onSelect ? "span" : "p", "event-title", formatted.title);
  content.append(meta, title);
  if (formatted.detail || formatted.coordinates.length) {
    const detail = element(onSelect ? "span" : "div", "event-detail");
    if (formatted.detail) detail.append(element("span", "", formatted.detail));
    formatted.coordinates.forEach((coordinate, index) => {
      if (formatted.graphic?.kind === "checkers" && index > 0) detail.append(element("span", "", "→"));
      detail.append(element("span", "event-coordinate", coordinate));
    });
    content.append(detail);
  }
  const target = onSelect ? document.createElement("button") : item;
  if (onSelect) {
    const button = target as HTMLButtonElement;
    button.type = "button";
    button.className = "event-select";
    button.append(element("span", "sr-only", "Show position after: "));
    button.addEventListener("click", () => onSelect(event.seq));
    item.append(button);
  }
  target.append(marker, content);
  if (formatted.graphic) {
    const graphic = actionGraphic(document, formatted.graphic, formatted.coordinates.join(" → "));
    // Selectable cards already describe the move in text; avoid a duplicate image name.
    if (onSelect) graphic.setAttribute("aria-hidden", "true");
    target.append(graphic);
  }
  return item;
}

function actionGraphic(document: Document, graphic: Graphic, label: string): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "event-graphic");
  svg.setAttribute("viewBox", "0 0 100 100");
  svg.setAttribute("width", "72");
  svg.setAttribute("height", "72");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", `${graphic.kind === "fleet" ? (graphic.target ? "Target" : "Visible placement") : "Action"}: ${label}`);
  const shape = (tag: string, attributes: Record<string, string | number>) => {
    const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
    for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
    svg.append(node);
    return node;
  };
  const size = graphic.kind === "tic" ? 3 : graphic.kind === "four" ? 7 : graphic.kind === "checkers" ? 8 : 10;
  const rows = graphic.kind === "four" ? 6 : size;
  const step = 84 / size;
  const rowStep = 84 / rows;
  shape("rect", { x: 8, y: 8, width: 84, height: 84, fill: "none", stroke: "currentColor", opacity: ".3" });
  for (let index = 1; index < size; index += 1) {
    shape("path", { d: `M${8 + index * step} 8V92`, fill: "none", stroke: "currentColor", opacity: ".15" });
  }
  for (let index = 1; index < rows; index += 1) {
    shape("path", { d: `M8 ${8 + index * rowStep}H92`, fill: "none", stroke: "currentColor", opacity: ".15" });
  }
  const highlight = (column: number, row: number) => shape("rect", {
    x: 8 + column * step + 1, y: 8 + row * step + 1, width: step - 2, height: step - 2,
    fill: "currentColor", opacity: ".65",
  });
  if (graphic.kind === "tic") {
    const row = Number(graphic.cell[1]) - 1;
    const column = Number(graphic.cell[3]) - 1;
    highlight(column, row);
    if (graphic.mark) {
      const mark = shape("text", { x: 8 + (column + .5) * step, y: 8 + (row + .5) * step,
        "text-anchor": "middle", "dominant-baseline": "central", "font-size": 18, fill: "currentColor" });
      mark.textContent = graphic.mark;
    }
  } else if (graphic.kind === "four") {
    shape("rect", { x: 8 + (graphic.column - 1) * step + 1, y: 8, width: step - 2, height: 84, fill: "currentColor", opacity: ".25" });
    const x = 8 + (graphic.column - .5) * step;
    shape("path", { d: `M${x} 20V72 m-4 -5 4 5 4 -5`, fill: "none", stroke: "currentColor", "stroke-width": 2 });
  } else if (graphic.kind === "checkers") {
    const points = graphic.path.map((square) => {
      const row = Math.floor((square - 1) / 4);
      const column = ((square - 1) % 4) * 2 + (row % 2 === 0 ? 1 : 0);
      return `${8 + (column + .5) * step},${8 + (row + .5) * step}`;
    });
    shape("polyline", { points: points.join(" "), fill: "none", stroke: "currentColor", "stroke-width": 2 });
    points.forEach((point, index) => {
      const [cx, cy] = point.split(",");
      shape("circle", { cx, cy, r: index === points.length - 1 ? 3 : 2, fill: "currentColor" });
    });
  } else {
    for (const cell of graphic.cells) highlight(cell.charCodeAt(0) - 65, Number(cell.slice(1)) - 1);
    if (graphic.target) {
      const cell = graphic.cells[0];
      const x = 8 + (cell.charCodeAt(0) - 65 + .5) * step;
      const y = 8 + (Number(cell.slice(1)) - .5) * step;
      shape("circle", { cx: x, cy: y, r: 7, fill: "none", stroke: "currentColor", "stroke-width": 1.5 });
    }
  }
  return svg;
}
