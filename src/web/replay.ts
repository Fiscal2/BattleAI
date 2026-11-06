import type { Position } from "./types.js";

export type ReplayDependencies = {
  loadPosition?: (seq: number, signal: AbortSignal) => Promise<Position>;
  schedule?: (callback: () => void, delay: number) => () => void;
};

export function createReplay(document: Document, matchId: string, initial: Position,
  display: (position: Position, live: boolean) => void, deps: ReplayDependencies = {}) {
  const prev = document.querySelector<HTMLButtonElement>("#replay-prev");
  const next = document.querySelector<HTMLButtonElement>("#replay-next");
  const play = document.querySelector<HTMLButtonElement>("#replay-play");
  const speed = document.querySelector<HTMLSelectElement>("#replay-speed");
  const seek = document.querySelector<HTMLInputElement>("#replay-seek");
  const label = document.querySelector<HTMLElement>("#replay-position");
  const liveButton = document.querySelector<HTMLButtonElement>("#replay-live");
  const error = document.querySelector<HTMLElement>("#replay-error");
  const unseenLabel = document.querySelector<HTMLElement>("#replay-unseen");
  let unseen = 0;
  const cards = new Map<number, HTMLLIElement>();
  let highlighted: HTMLLIElement | undefined;
  let latest = initial;
  let finished = initial.result !== null;
  let selected = initial;
  let following = true;
  let target = initial.seq;
  let request: AbortController | null = null;
  let playing = false;
  let cancelTimer: (() => void) | null = null;
  const schedule = deps.schedule ?? ((callback: () => void, delay: number) => {
    const timer = setTimeout(callback, delay);
    return () => clearTimeout(timer);
  });
  const loadPosition = deps.loadPosition ?? (async (seq: number, signal: AbortSignal) => {
    const response = await fetch(`/matches/${encodeURIComponent(matchId)}/position?seq=${seq}`, {
      credentials: "same-origin", cache: "no-store", signal,
    });
    if (!response.ok) throw new Error("Position unavailable");
    return await response.json() as Position;
  });

  function update() {
    const focused = document.activeElement;
    if (unseenLabel) {
      unseenLabel.textContent = unseen ? `${unseen} unseen event${unseen === 1 ? "" : "s"}` : "";
      unseenLabel.hidden = unseen === 0;
    }
    if (liveButton) {
      liveButton.disabled = following;
      liveButton.textContent = finished ? "Return to latest" : "Return to live";
    }
    const description = selected.seq === 0 ? "Before the match" : `Position after #${selected.seq}`;
    const followingText = finished ? `Latest position after #${latest.seq}` : `Live · ${description}`;
    if (label) label.textContent = request ? `Loading position after #${target}…` : following ? followingText : description;
    if (play) {
      play.textContent = playing ? "Pause" : "Play";
      play.setAttribute("aria-pressed", String(playing));
      play.disabled = latest.seq === 0;
    }
    if (prev) prev.disabled = target <= 0;
    if (next) next.disabled = target >= latest.seq;
    if (seek) {
      seek.min = "0";
      seek.max = String(latest.seq);
      seek.value = String(target);
      seek.setAttribute("aria-valuetext", request ? `Loading position after #${target}` : description);
    }
    // Boundary actions can disable their own button. Keep focus inside the replay controls.
    if (focused && [prev, next, play, liveButton].some(control => control === focused && control?.disabled)) seek?.focus();
    const card = cards.get(selected.seq);
    if (card !== highlighted) {
      highlighted?.classList.remove("is-selected");
      highlighted?.querySelector(".event-select")?.removeAttribute("aria-current");
      card?.classList.add("is-selected");
      card?.querySelector(".event-select")?.setAttribute("aria-current", "step");
      highlighted = card;
    }
  }

  function stopPlayback(cancelRequest = false) {
    playing = false;
    cancelTimer?.();
    cancelTimer = null;
    if (cancelRequest) {
      request?.abort();
      request = null;
      target = selected.seq;
    }
  }
  function scheduleNext() {
    cancelTimer?.();
    cancelTimer = null;
    if (!playing || request) return;
    if (selected.seq >= latest.seq) { stopPlayback(); return; }
    const rate = Number(speed?.value ?? 1);
    cancelTimer = schedule(() => {
      cancelTimer = null;
      void select(selected.seq + 1, true);
    }, 1000 / ([.5, 1, 2].includes(rate) ? rate : 1));
  }

  async function select(seq: number, playback = false) {
    if (!Number.isSafeInteger(seq) || seq < 0 || seq > latest.seq) { update(); return; }
    if (!playback) stopPlayback();
    following = false;
    target = seq;
    request?.abort();
    const current = new AbortController();
    request = current;
    if (error) error.textContent = "";
    update();
    try {
      const position = await loadPosition(seq, current.signal);
      if (request !== current || current.signal.aborted) return;
      if (!position || position.seq !== seq) throw new Error("Unexpected position");
      request = null;
      selected = position;
      display(position, false);
      scheduleNext();
    } catch {
      if (request !== current || current.signal.aborted) return;
      request = null;
      target = selected.seq;
      stopPlayback();
      if (error) error.textContent = `Could not load this position. Select an event to retry or use ${finished ? "Return to latest" : "Return to live"}.`;
    }
    update();
  }

  function returnLive() {
    stopPlayback(true);
    following = true;
    unseen = 0;
    if (error) error.textContent = "";
    selected = latest;
    target = latest.seq;
    display(latest, true);
    update();
  }
  prev?.addEventListener("click", () => { void select(target - 1); });
  next?.addEventListener("click", () => { void select(target + 1); });
  seek?.addEventListener("input", () => { void select(Number(seek.value)); });
  play?.addEventListener("click", () => {
    if (playing) stopPlayback(true);
    else {
      playing = true;
      following = false;
      if (target >= latest.seq) void select(0, true);
      else if (request) void select(target, true);
      else scheduleNext();
    }
    update();
  });
  speed?.addEventListener("change", () => { scheduleNext(); update(); });
  liveButton?.addEventListener("click", returnLive);
  update();
  return {
    select,
    isLive: () => following,
    register(seq: number, card: HTMLLIElement) {
      cards.set(seq, card);
      if (seq === selected.seq) update();
    },
    updateLive(position: Position, complete = position.result !== null) {
      finished = complete;
      if (!following && position.seq > latest.seq) unseen += 1;
      latest = position;
      if (following) { selected = latest; target = latest.seq; display(latest, true); }
      update();
    },
  };
}
