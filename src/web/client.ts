import { createBoardRenderer } from "./board.js";
import { eventCard, resultText } from "./feed.js";
import { agentName, isSeat, type Boot, type MatchResult, type ShownEvent, type View } from "./types.js";

declare global {
  interface Window {
    __events?: ShownEvent[];
  }
}

export function startClient(document: Document, initialEvents: ShownEvent[], createSource: (url: string) => EventSource, refresh?: () => void) {
  const boot = JSON.parse(document.querySelector<HTMLScriptElement>("#boot")!.textContent || "{}") as Boot;
  const board = document.querySelector<HTMLElement>("#board")!;
  const events = document.querySelector<HTMLOListElement>("#events")!;
  const count = document.querySelector<HTMLElement>("#event-count");
  const connection = document.querySelector<HTMLElement>("#connection-status");
  const status = document.querySelector<HTMLElement>("#match-status") ?? document.querySelector<HTMLElement>(".status-pill");
  const dot = document.querySelector<HTMLElement>(".status-pill .dot");
  const page = document.querySelector<HTMLElement>(".match-page");
  const seen = new Set<number>();
  let view = boot.view;
  let result = boot.result ?? null;
  let finished = boot.status === "finished" || result !== null;
  let refreshing = false;
  let source: EventSource | null = null;
  const context = { game: boot.game, names: { ...boot.names }, firstSeat: boot.firstSeat, view };

  function learn(event: ShownEvent) {
    if (event.type === "seated" && isSeat(event.payload.seat) && typeof event.payload.displayName === "string") {
      context.names[String(event.payload.seat)] = event.payload.displayName;
    }
    if (!isSeat(context.firstSeat) && boot.game !== "fleet" && event.type === "action" && isSeat(event.payload.seat)) {
      context.firstSeat = event.payload.seat;
    }
    if (event.type === "result") {
      result = event.payload as MatchResult;
      finished = true;
    }
  }
  for (const event of initialEvents) learn(event);
  const renderBoard = createBoardRenderer(board, context);

  const updateCount = () => { if (count) count.textContent = String(seen.size); };
  const connectionStatus = (text: string) => { if (connection) connection.textContent = text; };
  function updateStatus() {
    const complete = finished || (view !== null && view.outcome !== "ongoing");
    if (status) status.textContent = result ? resultText(result, context.names).title
      : view?.outcome === "draw" ? "Draw"
      : view && view.outcome !== "ongoing" ? `${agentName(context.names, view.outcome.winner)} wins`
      : finished ? "Finished" : view ? "In progress" : "Waiting for opponent";
    if (dot) {
      dot.classList.remove("waiting", "active", "finished");
      dot.classList.add(complete ? "finished" : view ? "active" : "waiting");
    }
    if (page && isSeat(context.firstSeat)) {
      page.classList.remove("first-seat-0", "first-seat-1");
      page.classList.add(`first-seat-${context.firstSeat}`);
    }
  }
  function addEvent(event: ShownEvent, parent: HTMLElement | DocumentFragment) {
    if (seen.has(event.seq)) return false;
    seen.add(event.seq);
    parent.append(eventCard(document, event, context));
    return true;
  }
  const fragment = document.createDocumentFragment();
  for (const event of initialEvents) addEvent(event, fragment);
  events.append(fragment);
  updateCount();
  renderBoard(view, result, finished);
  updateStatus();
  const followLatest = () => { events.scrollTop = events.scrollHeight; };
  followLatest();
  // Let deferred timeline rows settle before the first paint's final scroll position.
  document.defaultView?.requestAnimationFrame(followLatest);

  if (finished) {
    connectionStatus("Match complete");
    return;
  }
  connectionStatus("Connecting…");
  // Native EventSource preserves Last-Event-ID on reconnect; replayed events are also deduplicated here.
  source = createSource(`/matches/${encodeURIComponent(boot.matchId)}/events?after=${boot.seq}`);
  source.onopen = () => { if (!finished && !refreshing) connectionStatus("Live"); };
  source.onerror = () => {
    if (!finished && !refreshing) connectionStatus(source?.readyState === 2 ? "Disconnected. Reload to reconnect." : "Reconnecting…");
  };
  source.onmessage = (message) => {
    let data: { event: ShownEvent; view: View | null };
    try {
      data = JSON.parse(message.data);
    } catch {
      connectionStatus("Could not read an update. Reload to reconnect.");
      return;
    }
    if (finished || refreshing || !data?.event || !Number.isSafeInteger(data.event.seq) || typeof data.event.type !== "string" || !data.event.payload
      || typeof data.event.payload !== "object" || Array.isArray(data.event.payload) || seen.has(data.event.seq)) return;
    learn(data.event);
    if (data.view) {
      view = data.view;
      context.view = view;
      // A waiting page learns the first mover from the initial public board, before the first action arrives.
      if (!isSeat(context.firstSeat) && data.event.type === "seated" && view.game !== "fleet" && isSeat(view.turn)) {
        context.firstSeat = view.turn;
      }
    }
    const follow = events.scrollHeight - events.scrollTop - events.clientHeight < 48;
    addEvent(data.event, events);
    updateCount();
    renderBoard(view, result, finished);
    updateStatus();
    if (follow) followLatest();
    if (finished) {
      source?.close();
      connectionStatus("Match complete");
    } else if (data.event.type === "seated" && data.event.payload.seat === 1 && refresh) {
      // Seating also changes server-only heading/snapshot content. Fetch that authoritative page once.
      refreshing = true;
      source?.close();
      connectionStatus("Updating match…");
      refresh();
    } else connectionStatus("Live");
  };
  return source;
}

if (typeof document !== "undefined" && typeof window !== "undefined") {
  startClient(document, window.__events ?? [], (url) => new EventSource(url), () => window.location.reload());
}
