import { describe, expect, it, vi } from "vitest";
import { startClient } from "../../src/web/client.ts";
import type { Boot, MatchResult, ShownEvent, View } from "../../src/web/types.ts";
import { DocumentFixture } from "./dom.ts";

const view: Extract<View, { game: "tictactoe" }> = {
  game: "tictactoe", cells: Array(9).fill(null), turn: 1, lastCell: null, outcome: "ongoing",
};
const boot: Boot = { matchId: "match-1", seq: 2, game: "tictactoe", names: { "0": "Ada", "1": "Bea" }, view, status: "active", firstSeat: 1 };
const forfeit: MatchResult = { result: "forfeit", winnerSeat: 0, forfeitSeat: 1, forfeitCause: "model_error" };
const seated: ShownEvent = { seq: 2, type: "seated", payload: { seat: 1, displayName: "Bea" } };
const move: ShownEvent = { seq: 3, type: "action", payload: { seat: 1, action: { cell: "r2c2" } } };

function fixture(input: Boot = boot, initial: ShownEvent[] = [], options: { optional?: boolean; nestedStatus?: boolean; refresh?: () => void; scrollHeight?: number } = {}) {
  const document = new DocumentFixture();
  document.mount("#boot", "script", JSON.stringify(input));
  const board = document.mount("#board", "div");
  const events = document.mount("#events", "ol");
  events.scrollHeight = options.scrollHeight ?? 0;
  const pill = document.mount(".status-pill", "p");
  const status = options.nestedStatus === false ? pill : document.mount("#match-status", "span");
  const dot = document.mount(".status-pill .dot", "span");
  dot.className = "dot active";
  if (status !== pill) pill.append(dot, status);
  const page = document.mount(".match-page", "main");
  page.className = "match-page first-seat-0";
  const count = options.optional === false ? null : document.mount("#event-count", "span");
  const connection = options.optional === false ? null : document.mount("#connection-status", "span");
  const source = {
    onmessage: null as null | ((message: { data: string }) => void),
    onopen: null as null | (() => void),
    onerror: null as null | (() => void),
    readyState: 0,
    close: vi.fn(),
    emit(event: ShownEvent, nextView: View | null = view) {
      this.onmessage?.({ data: JSON.stringify({ event, view: nextView }) });
    },
  };
  const createSource = vi.fn(() => source as unknown as EventSource);
  startClient(document.asDocument(), initial, createSource, options.refresh);
  return { document, board, events, status, pill, dot, page, count, connection, source, createSource };
}

describe("browser entry point", () => {
  it("scrolls the initial batched feed to the newest event", () => {
    const page = fixture(boot, [seated, move], { scrollHeight: 1000 });
    expect(page.events.appendCalls).toBe(1);
    expect(page.events.scrollTop).toBe(1000);
    page.events.scrollTop = 753;
    page.events.clientHeight = 200;
    page.source.emit(move);
    expect(page.events.scrollTop).toBe(753);
  });

  it.each([0, 47, 48, 200])("follows live appends only when the pre-append bottom gap is below 48 pixels (gap %i)", (gap) => {
    const page = fixture();
    page.events.scrollHeight = 1000;
    page.events.clientHeight = 200;
    page.events.scrollTop = 800 - gap;
    const append = page.events.append.bind(page.events);
    vi.spyOn(page.events, "append").mockImplementation((...nodes) => {
      append(...nodes);
      page.events.scrollHeight += 100;
    });
    page.source.emit(move);
    expect(page.events.children).toHaveLength(1);
    expect(page.events.scrollTop).toBe(gap < 48 ? 1100 : 800 - gap);
  });

  it("batches initial insertion, preserves order and appends each live sequence once", () => {
    const page = fixture(boot, [seated, seated, move]);
    expect(page.events.appendCalls).toBe(1);
    expect(page.events.children.map((event) => event.dataset.seq)).toEqual(["2", "3"]);
    expect(page.count?.textContent).toBe("2");
    const first = page.events.children[0];
    page.source.emit(move);
    page.source.emit({ seq: 4, type: "action", payload: { seat: 0, action: { cell: "r1c1" } } });
    expect(page.events.children.map((event) => event.dataset.seq)).toEqual(["2", "3", "4"]);
    expect(page.events.children[0]).toBe(first);
    expect(page.events.replaceCalls).toBe(0);
    expect(page.count?.textContent).toBe("3");
    expect(page.createSource).toHaveBeenCalledWith("/matches/match-1/events?after=2");
  });

  it("shows boot forfeit results without opening a finished match stream", () => {
    const page = fixture({ ...boot, status: "finished", result: forfeit });
    expect(page.createSource).not.toHaveBeenCalled();
    expect(page.board.find("board-caption")[0].textContent).toBe("Ada wins by forfeit. Bea forfeited after model errors.");
    expect(page.status.textContent).toBe("Ada wins by forfeit");
    expect(page.pill.children).toContain(page.dot);
    expect(page.dot.className).toBe("dot finished");
    expect(page.connection?.textContent).toBe("Match complete");
  });

  it("also detects completion from initial result events for older boot payloads", () => {
    const page = fixture({ ...boot, status: undefined, result: undefined }, [{ seq: 4, type: "result", payload: forfeit }]);
    expect(page.createSource).not.toHaveBeenCalled();
    expect(page.events.textContent).toContain("Bea forfeited after model errors.");
  });

  it("closes on a live forfeit with an ongoing board and preserves board nodes", () => {
    const page = fixture(boot, [seated]);
    const grid = page.board.find("tic")[0];
    page.source.emit({ seq: 4, type: "result", payload: forfeit });
    expect(page.source.close).toHaveBeenCalledOnce();
    expect(page.board.find("tic")[0]).toBe(grid);
    expect(page.board.find("board-caption")[0].textContent).toContain("Ada wins by forfeit");
    expect(page.events.textContent).toContain("Bea forfeited after model errors.");
    expect(page.connection?.textContent).toBe("Match complete");
    page.source.onerror?.();
    expect(page.connection?.textContent).toBe("Match complete");
  });

  it("keeps the stream until a natural win's result arrives and renders that action only once", () => {
    const page = fixture();
    const won = { ...view, cells: ["X", "X", "X", null, null, null, null, null, null], turn: null, outcome: { winner: 1 as const } } as typeof view;
    page.source.emit(move, won);
    expect(page.source.close).not.toHaveBeenCalled();
    const grid = page.board.find("tic")[0];
    page.source.emit({ seq: 4, type: "result", payload: { result: "decided", winnerSeat: 1, forfeitSeat: null, forfeitCause: "" } }, won);
    expect(page.board.find("tic")[0]).toBe(grid);
    expect(page.source.close).toHaveBeenCalledOnce();
    expect(page.status.textContent).toBe("Bea wins");
    expect(page.events.children).toHaveLength(2);
  });

  it("reports reconnects and recovers on open, tolerates malformed data, and has optional status nodes", () => {
    const page = fixture();
    expect(page.connection?.textContent).toBe("Connecting…");
    page.source.onopen?.();
    expect(page.connection?.textContent).toBe("Live");
    page.source.onerror?.();
    expect(page.connection?.textContent).toBe("Reconnecting…");
    page.source.onmessage?.({ data: "not JSON" });
    expect(page.events.children).toHaveLength(0);
    page.source.onopen?.();
    page.source.emit(move);
    expect(page.connection?.textContent).toBe("Live");
    page.source.readyState = 2;
    page.source.onerror?.();
    expect(page.connection?.textContent).toBe("Disconnected. Reload to reconnect.");
    const minimal = fixture(boot, [], { optional: false, nestedStatus: false });
    expect(() => minimal.source.emit({ seq: 4, type: "result", payload: forfeit })).not.toThrow();
  });

  it("learns the joining name and first mover from a waiting page without guessing marks", () => {
    const page = fixture({ ...boot, seq: 1, view: null, status: "waiting", firstSeat: null, names: { "0": "Ada" } });
    expect(page.status.textContent).toBe("Waiting for opponent");
    expect(page.board.textContent).toContain("Waiting for the second coach.");
    page.source.emit(seated, view);
    expect(page.status.textContent).toBe("In progress");
    expect(page.page.className).toBe("match-page first-seat-1");
    const grid = page.board.find("tic")[0];
    page.source.emit({ ...seated, seq: 5 }, view);
    expect(page.board.find("tic")[0]).toBe(grid);
    page.source.emit(move, { ...view, cells: [null, null, null, null, "X", null, null, null, null], lastCell: "r2c2", turn: 0 });
    expect(page.events.children.at(-1)?.textContent).toContain("BeaAction#3Placed X");
    expect(page.board.find("square")[4].attributes["aria-label"]).toBe("r2c2: X, Bea");
  });

  it("refreshes the authoritative heading and snapshots exactly once on a new live seat-one event", () => {
    const refresh = vi.fn();
    const page = fixture({ ...boot, view: null, status: "waiting", firstSeat: null }, [], { refresh });
    expect(refresh).not.toHaveBeenCalled();
    page.source.emit(seated, view);
    expect(page.source.close).toHaveBeenCalledOnce();
    expect(refresh).toHaveBeenCalledOnce();
    page.source.emit(seated, view);
    page.source.emit({ ...seated, seq: 5 }, view);
    expect(refresh).toHaveBeenCalledOnce();
    expect(page.events.children).toHaveLength(1);
    const initial = fixture(boot, [seated], { refresh });
    initial.source.emit(seated, view);
    expect(refresh).toHaveBeenCalledOnce();
    expect(initial.source.close).not.toHaveBeenCalled();
  });
});
