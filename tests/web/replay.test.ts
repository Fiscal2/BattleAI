import { describe, expect, it, vi } from "vitest";
import { startClient } from "../../src/web/client.ts";
import type { ReplayDependencies } from "../../src/web/replay.ts";
import type { Boot, MatchResult, Position, ShownEvent, View } from "../../src/web/types.ts";
import { DocumentFixture } from "./dom.ts";

const empty: Extract<View, { game: "tictactoe" }> = {
  game: "tictactoe", cells: Array(9).fill(null), turn: 1, lastCell: null, outcome: "ongoing",
};
const moved: typeof empty = { ...empty, cells: [null, null, null, null, "X", null, null, null, null], turn: 0, lastCell: "r2c2" };
const result: MatchResult = { result: "forfeit", winnerSeat: 0, forfeitSeat: 1, forfeitCause: "model_error" };
const initial: ShownEvent[] = [
  { seq: 1, type: "seated", payload: { seat: 0, displayName: "Ada" } },
  { seq: 2, type: "seated", payload: { seat: 1, displayName: "Bea" } },
  { seq: 3, type: "action", payload: { seat: 1, action: { cell: "r2c2" } } },
];
const boot: Boot = { matchId: "match /1", seq: 3, game: "tictactoe", names: { "0": "Ada", "1": "Bea" }, firstSeat: 1, view: moved, result: null, status: "active" };
const position = (seq: number, overrides: Partial<Position> = {}): Position => ({
  seq, view: empty, names: { "0": "Ada", "1": "Bea" }, firstSeat: 1, result: null, ...overrides,
});
const flush = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };

function setup(deps: ReplayDependencies = {}, input: Boot = boot, events = initial, refresh?: () => void) {
  const document = new DocumentFixture();
  document.mount("#boot", "script", JSON.stringify(input));
  const board = document.mount("#board", "div");
  const feed = document.mount("#events", "ol");
  const status = document.mount("#match-status", "span");
  document.mount(".match-page", "main");
  const connection = document.mount("#connection-status", "span");
  document.mount("#replay-controls", "section");
  const prev = document.mount("#replay-prev", "button");
  const next = document.mount("#replay-next", "button");
  const play = document.mount("#replay-play", "button");
  const speed = document.mount("#replay-speed", "select");
  speed.value = "1";
  const seek = document.mount("#replay-seek", "input");
  const label = document.mount("#replay-position", "span");
  const live = document.mount("#replay-live", "button");
  const unseen = document.mount("#replay-unseen", "span");
  unseen.hidden = true;
  const error = document.mount("#replay-error", "p");
  const source = {
    close: vi.fn(), onopen: null as (() => void) | null, onerror: null as (() => void) | null,
    onmessage: null as ((message: { data: string }) => void) | null,
    emit(data: unknown) { this.onmessage?.({ data: JSON.stringify(data) }); },
  };
  const createSource = vi.fn(() => source as unknown as EventSource);
  startClient(document.asDocument(), events, createSource, refresh, deps);
  const select = (seq: number) => feed.children.find((card) => card.dataset.seq === String(seq))!.find("event-select")[0].click();
  return { document, board, feed, status, connection, prev, next, play, speed, seek, label, live, unseen, error, source, createSource, select };
}

describe("interactive replay through the browser entry point", () => {
  it("selects a finished match's real card using only the authoritative prefix context", async () => {
    const loadPosition = vi.fn(async (seq: number) => position(seq, { names: { "0": "Earlier Ada", "1": "Earlier Bea" }, firstSeat: 0 }));
    const page = setup({ loadPosition }, { ...boot, seq: 4, status: "finished", result }, [...initial, { seq: 4, type: "result", payload: result }]);
    expect(page.board.textContent).toContain("Ada wins by forfeit");
    expect(page.label.textContent).toBe("Latest position after #4");
    expect(page.live.disabled).toBe(true);
    page.select(2);
    await flush();
    expect(loadPosition.mock.calls[0][0]).toBe(2);
    expect(page.board.textContent).toContain("Earlier Bea to move");
    expect(page.board.textContent).not.toContain("forfeit");
    expect(page.board.find("board-legend")[0].textContent).toContain("Earlier Ada · X");
    expect(page.label.textContent).toBe("Position after #2");
    expect(page.feed.children[1].find("event-select")[0].attributes["aria-current"]).toBe("step");
    expect(page.createSource).not.toHaveBeenCalled();
    page.live.click();
    expect(page.board.textContent).toContain("Ada wins by forfeit");
  });
  it("keeps history fixed while live events append once and completion closes the stream", async () => {
    const page = setup({ loadPosition: async (seq) => position(seq) });
    page.select(2);
    await flush();
    const historicalBoard = page.board.textContent;
    page.feed.scrollHeight = 1000;
    page.feed.scrollTop = 700;
    page.feed.clientHeight = 300;
    const finish = { event: { seq: 4, type: "result", payload: result }, view: moved };
    page.source.emit(finish);
    page.source.emit(finish);
    expect(page.board.textContent).toBe(historicalBoard);
    expect(page.feed.children).toHaveLength(4);
    expect(page.unseen.textContent).toBe("1 unseen event");
    expect(page.unseen.hidden).toBe(false);
    expect(page.feed.scrollTop).toBe(700);
    expect(page.source.close).toHaveBeenCalledOnce();
    expect(page.label.textContent).toBe("Position after #2");
    page.live.click();
    expect(page.board.textContent).toContain("Ada wins by forfeit");
    expect(page.label.textContent).toBe("Latest position after #4");
    expect(page.unseen.textContent).toBe("");
    expect(page.unseen.hidden).toBe(true);
    expect(page.live.disabled).toBe(true);
  });

  it("ignores out-of-order fetches and a pending response after Return to live", async () => {
    const requests: Array<{ seq: number; signal: AbortSignal; resolve: (value: Position) => void }> = [];
    const page = setup({ loadPosition: (seq, signal) => new Promise((resolve) => { requests.push({ seq, signal, resolve }); }) });
    page.select(1);
    page.select(2);
    expect(requests[0].signal.aborted).toBe(true);
    requests[1].resolve(position(2));
    await flush();
    requests[0].resolve(position(1, { view: null, firstSeat: null, names: { "0": "Ada" } }));
    await flush();
    expect(page.label.textContent).toBe("Position after #2");
    expect(page.board.textContent).toContain("Bea to move");
    page.select(1);
    page.live.click();
    expect(requests[2].signal.aborted).toBe(true);
    requests[2].resolve(position(1, { view: null, firstSeat: null }));
    await flush();
    expect(page.label.textContent).toBe("Live · Position after #3");
    expect(page.board.find("square")[4].attributes["aria-label"]).toBe("r2c2: X, Bea");
  });

  it("shows a recoverable fetch error without replacing the displayed board", async () => {
    const loadPosition = vi.fn<(seq: number, signal: AbortSignal) => Promise<Position>>()
      .mockRejectedValueOnce(new Error("private database / provider detail"))
      .mockResolvedValueOnce(position(1, { view: null, firstSeat: null, names: { "0": "Ada" } }));
    const page = setup({ loadPosition });
    const before = page.board.textContent;
    page.select(1);
    await flush();
    expect(page.error.textContent).toContain("Could not load this position");
    expect(page.error.textContent).toContain("Return to live");
    expect(page.error.textContent).not.toContain("private");
    expect(page.board.textContent).toBe(before);
    page.select(1);
    await flush();
    expect(page.error.textContent).toBe("");
    expect(page.board.textContent).toContain("Waiting for the second coach.");
    expect(page.board.find("board-legend")[0].textContent).toBe("");
    expect(page.label.textContent).toBe("Position after #1");
  });

  it("steps through events and seeks to before seating with bounded native controls", async () => {
    const loadPosition = vi.fn(async (seq: number) => position(seq, seq < 2
      ? { view: null, firstSeat: null, names: seq === 0 ? {} : { "0": "Ada" } }
      : { view: seq === 3 ? moved : empty }));
    const page = setup({ loadPosition });
    expect(page.seek.min).toBe("0");
    expect(page.seek.max).toBe("3");
    expect(page.next.disabled).toBe(true);
    page.prev.click();
    await flush();
    expect(page.label.textContent).toBe("Position after #2");
    page.next.click();
    await flush();
    expect(page.label.textContent).toBe("Position after #3");
    page.seek.value = "0";
    page.seek.dispatch("input");
    await flush();
    expect(page.label.textContent).toBe("Before the match");
    expect(page.prev.disabled).toBe(true);
    expect(page.board.textContent).toContain("Waiting for the second coach.");
    for (const invalid of ["-1", "4", "0.5", "9007199254740992", "NaN"]) {
      page.seek.value = invalid;
      page.seek.dispatch("input");
    }
    expect(loadPosition).toHaveBeenCalledTimes(3);
    page.next.click();
    await flush();
    expect(page.label.textContent).toBe("Position after #1");
    page.source.emit({ event: { seq: 4, type: "result", payload: result }, view: moved });
    expect(page.seek.max).toBe("4");
    expect(page.seek.value).toBe("1");
    expect(page.seek.attributes["aria-valuetext"]).toBe("Position after #1");
  });

  it.each([0, 1])("defers the seating refresh while inspecting #%i and learns authoritative Fleet sides in live context only", async (seq) => {
    const refresh = vi.fn();
    let resolve!: (value: Position) => void;
    const fleet: Extract<View, { game: "fleet" }> = { game: "fleet", phase: "place", ships: [], shots: [], lastShot: null, turn: 0, outcome: "ongoing" };
    const page = setup({ loadPosition: () => new Promise((done) => { resolve = done; }) },
      { ...boot, game: "fleet", seq: 1, view: null, names: { "0": "Ada" }, firstSeat: null, status: "waiting" }, [initial[0]], refresh);
    if (seq === 0) { page.seek.value = "0"; page.seek.dispatch("input"); }
    else page.select(1);
    page.source.emit({ event: initial[1], view: fleet, firstSeat: 1, names: { "0": "Ada", "1": "Joined Bea" } });
    expect(refresh).not.toHaveBeenCalled();
    expect(page.source.close).not.toHaveBeenCalled();
    expect(page.label.textContent).toBe(`Loading position after #${seq}…`);
    resolve(position(seq, { view: null, firstSeat: null, names: seq === 0 ? {} : { "0": "Ada" } }));
    await flush();
    expect(page.label.textContent).toBe(seq === 0 ? "Before the match" : "Position after #1");
    const placed = { ...fleet, phase: "shoot" as const, turn: 1 as const };
    page.source.emit({ event: { seq: 3, type: "action", payload: { seat: 0, action: { placed: true } } }, view: placed,
      firstSeat: 1, names: { "0": "Ada", "1": "Joined Bea" } });
    expect(page.board.textContent).toContain("Waiting for the second coach.");
    expect(page.source.close).not.toHaveBeenCalled();
    page.live.click();
    expect(page.board.textContent).toContain("Joined Bea to move");
    expect(page.document.querySelector(".match-page")?.className).toBe("first-seat-1");
    expect(page.source.close).toHaveBeenCalledOnce();
    expect(refresh).toHaveBeenCalledOnce();
    page.live.click();
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("plays on explicit request, changes speed, pauses, resumes and stops at the latest event", async () => {
    vi.useFakeTimers();
    try {
      const loadPosition = vi.fn(async (seq: number) => position(seq, seq === 0
        ? { view: null, firstSeat: null, names: {} }
        : seq === 4 ? { result, view: moved } : {}));
      const page = setup({ loadPosition }, { ...boot, seq: 4, result, status: "finished" },
        [...initial, { seq: 4, type: "result", payload: result }]);
      expect(loadPosition).not.toHaveBeenCalled();
      expect(page.play.textContent).toBe("Play");
      page.play.click();
      await flush();
      expect(page.label.textContent).toBe("Before the match");
      expect(page.play.textContent).toBe("Pause");
      expect(page.play.attributes["aria-pressed"]).toBe("true");
      await vi.advanceTimersByTimeAsync(500);
      expect(page.label.textContent).toBe("Before the match");
      page.speed.value = "2";
      page.speed.dispatch("change");
      await vi.advanceTimersByTimeAsync(499);
      expect(page.label.textContent).toBe("Before the match");
      await vi.advanceTimersByTimeAsync(1);
      expect(page.label.textContent).toBe("Position after #1");
      page.play.click();
      await vi.advanceTimersByTimeAsync(5000);
      expect(page.label.textContent).toBe("Position after #1");
      expect(page.play.textContent).toBe("Play");
      page.play.click();
      await vi.advanceTimersByTimeAsync(1500);
      expect(page.label.textContent).toBe("Position after #4");
      expect(page.board.textContent).toContain("Ada wins by forfeit");
      expect(page.play.textContent).toBe("Play");
      expect(page.play.attributes["aria-pressed"]).toBe("false");
      expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); }
  });

  it("updates running/stopped notices without changing a historical board or its result", async () => {
    const page = setup({ loadPosition: async (seq) => position(seq) }, { ...boot, runner: "running" });
    page.select(2);
    await flush();
    const historical = page.board.textContent;
    for (const runner of ["stopped", "running", "unconfigured", "running"]) {
      page.source.emit({ runner });
      expect(page.status.textContent).toBe(runner === "running" ? "In progress" : "Play paused. Reload to retry.");
      expect(page.board.textContent).toBe(historical);
      expect(page.label.textContent).toBe("Position after #2");
    }
    expect(page.unseen.textContent).toBe("");
    expect(page.feed.children).toHaveLength(3);
    expect(page.source.close).not.toHaveBeenCalled();
  });

  it("rejects a position response for the wrong sequence and keeps recovery available", async () => {
    const page = setup({ loadPosition: async () => position(1, { view: null, firstSeat: null }) });
    const before = page.board.textContent;
    page.select(2);
    await flush();
    expect(page.board.textContent).toBe(before);
    expect(page.error.textContent).toContain("Could not load this position");
    expect(page.label.textContent).toBe("Position after #3");
    expect(page.live.disabled).toBe(false);
    page.live.click();
    expect(page.error.textContent).toBe("");
    expect(page.label.textContent).toBe("Live · Position after #3");
    expect(page.live.disabled).toBe(true);
  });

  it("loads positions with same-origin credentials and no cache, including repeat selections", async () => {
    const fetchPosition = vi.fn(async () => ({ ok: true, json: async () => position(2) }));
    vi.stubGlobal("fetch", fetchPosition);
    try {
      const page = setup();
      page.select(2);
      await flush();
      expect(page.label.textContent).toBe("Position after #2");
      expect(fetchPosition).toHaveBeenCalledWith("/matches/match%20%2F1/position?seq=2", {
        credentials: "same-origin", cache: "no-store", signal: expect.any(AbortSignal),
      });
      page.select(2);
      await flush();
      expect(fetchPosition).toHaveBeenCalledTimes(2);
    } finally { vi.unstubAllGlobals(); }
  });

  it.each(["http", "json"])("recovers from a %s response failure through the real fetch boundary", async (failure) => {
    const fetchPosition = vi.fn().mockResolvedValueOnce({ ok: failure !== "http", json: async () => { throw new Error("private details"); } })
      .mockResolvedValueOnce({ ok: true, json: async () => position(2) });
    vi.stubGlobal("fetch", fetchPosition);
    try {
      const page = setup();
      const before = page.board.textContent;
      page.select(2);
      await flush();
      expect(page.board.textContent).toBe(before);
      expect(page.error.textContent).toContain("Could not load this position");
      expect(page.error.textContent).not.toContain("private");
      page.select(2);
      await flush();
      expect(page.label.textContent).toBe("Position after #2");
      expect(page.error.textContent).toBe("");
    } finally { vi.unstubAllGlobals(); }
  });

  it("pauses an in-flight playback step without closing or freezing the live feed", async () => {
    vi.useFakeTimers();
    try {
      let complete!: (value: Position) => void;
      let signal!: AbortSignal;
      const page = setup({ loadPosition: (seq, abortSignal) => seq === 3
        ? new Promise((resolve) => { complete = resolve; signal = abortSignal; })
        : Promise.resolve(position(seq)) });
      page.select(2);
      await flush();
      const historical = page.board.textContent;
      page.play.click();
      await vi.advanceTimersByTimeAsync(1000);
      expect(page.label.textContent).toBe("Loading position after #3…");
      page.play.click();
      expect(signal.aborted).toBe(true);
      complete(position(3, { view: moved }));
      await flush();
      expect(page.label.textContent).toBe("Position after #2");
      expect(page.board.textContent).toBe(historical);
      page.source.emit({ event: { seq: 4, type: "action", payload: { seat: 0, action: { cell: "r1c1" } } }, view: moved });
      expect(page.unseen.textContent).toBe("1 unseen event");
      expect(page.board.textContent).toBe(historical);
      expect(page.source.close).not.toHaveBeenCalled();
      page.live.click();
      expect(page.board.find("square")[4].attributes["aria-label"]).toBe("r2c2: X, Bea");
      expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); }
  });

  it.each([["0.5", 2000], ["1", 1000], ["2", 500]] as const)("uses the %sx playback interval", async (rate, delay) => {
    vi.useFakeTimers();
    try {
      const page = setup({ loadPosition: async (seq) => position(seq, { view: seq === 3 ? moved : empty }) });
      page.select(2);
      await flush();
      page.speed.value = rate;
      page.speed.dispatch("change");
      page.play.click();
      await vi.advanceTimersByTimeAsync(delay - 1);
      expect(page.label.textContent).toBe("Position after #2");
      await vi.advanceTimersByTimeAsync(1);
      expect(page.label.textContent).toBe("Position after #3");
      expect(page.play.textContent).toBe("Play");
      expect(page.source.close).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); }
  });

});
