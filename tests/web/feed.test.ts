import { describe, expect, it, vi } from "vitest";
import { eventCard, formatEvent, resultText } from "../../src/web/feed.ts";
import { presentEvent } from "../../src/match/runner.ts";
import type { FeedContext, ShownEvent, View } from "../../src/web/types.ts";
import { DocumentFixture, NodeFixture } from "./dom.ts";

const context: FeedContext = { game: "tictactoe", names: { "0": "Ada", "1": "Bea" }, firstSeat: 1, view: null };
const action = (value: unknown, seat = 1): ShownEvent => ({ seq: 3, type: "action", payload: { seat, action: value } });
const fleetView: Extract<View, { game: "fleet" }> = {
  game: "fleet", phase: "shoot", turn: 0, ships: [], shots: [], lastShot: null, outcome: "ongoing",
};

describe("readable action formatting", () => {
  it("maps X/O to the actual first seat and avoids guessing when it is unknown", () => {
    expect(formatEvent(action({ cell: "r2c3" }), context)).toMatchObject({ title: "Placed X", agent: "Bea", seat: 1, coordinates: ["r2c3"] });
    expect(formatEvent(action({ cell: "r1c1" }, 0), context).title).toBe("Placed O");
    expect(formatEvent(action({ cell: "r1c1" }), { ...context, firstSeat: null }).title).toBe("Marked a cell");
  });

  it("uses actual Four columns and ordered Checkers path coordinates", () => {
    expect(formatEvent(action({ column: 7 }), { ...context, game: "four" })).toMatchObject({ title: "Dropped a disc", coordinates: ["Column 7"], graphic: { kind: "four", column: 7 } });
    expect(formatEvent(action({ path: [9, 18, 27] }), { ...context, game: "checkers" })).toMatchObject({ title: "Moved a piece", coordinates: ["9", "18", "27"], graphic: { kind: "checkers", path: [9, 18, 27] } });
  });

  it("requires matching seat AND cell shot evidence; a final reload view supplies that evidence", () => {
    const fleetContext = { ...context, game: "fleet", view: { ...fleetView, ships: [{ seat: 0 as const, length: 2, cells: ["A1", "A2"], sunk: false }] } };
    expect(formatEvent(action({ cell: "A1" }), fleetContext).title).toBe("Fired a shot");
    fleetContext.view.shots = [{ seat: 0, cell: "A1", hit: true }, { seat: 1, cell: "B1", hit: false }];
    expect(formatEvent(action({ cell: "A1" }), fleetContext).title).toBe("Fired a shot");
    expect(formatEvent(action({ cell: "B1" }), fleetContext).title).toBe("Shot missed");
    fleetContext.view.shots.push({ seat: 1, cell: "A1", hit: true });
    expect(formatEvent(action({ cell: "A1" }), fleetContext).title).toBe("Shot hit");
  });

  it("keeps redacted and malformed Fleet placements hidden, even with revealed ships in the view", () => {
    const placement = action({ ships: [{ length: 2, cells: ["A1", "A2"] }] });
    const redacted = presentEvent(placement, "fleet", 0);
    const fleetContext = { ...context, game: "fleet", view: { ...fleetView, ships: [{ seat: 1 as const, length: 2, cells: ["A1", "A2"], sunk: true }] } };
    expect(formatEvent(redacted, fleetContext)).toMatchObject({ title: "Placed the fleet", detail: "Placement hidden.", coordinates: [], graphic: null });
    expect(formatEvent(placement, fleetContext)).toMatchObject({ coordinates: ["2 cells · A1–A2"], graphic: { kind: "fleet", cells: ["A1", "A2"] } });
    expect(formatEvent(action({ ships: [{ length: 2 }] }), fleetContext)).toMatchObject({ coordinates: [], graphic: null });
    expect(formatEvent(action({ placed: true, ships: [{ cells: ["A1"] }] }), fleetContext).graphic).toBeNull();
  });

  it.each([
    ["tictactoe", { cell: "<svg onload=alert(1)>" }],
    ["four", { column: 8 }],
    ["checkers", { path: [1, 33] }],
    ["fleet", { cell: "K1" }],
  ])("does not draw invalid %s coordinates", (game, value) => {
    expect(formatEvent(action(value), { ...context, game })).toMatchObject({ title: "Action recorded", coordinates: [], graphic: null });
  });
});

describe("result and lifecycle formatting", () => {
  it.each(["model_error", "invalid_action"])("shows the forfeit winner, loser and %s cause", (cause) => {
    const event: ShownEvent = { seq: 4, type: "result", payload: { result: "forfeit", winnerSeat: 0, forfeitSeat: 1, forfeitCause: cause } };
    expect(formatEvent(event, context)).toMatchObject({ agent: "Ada", seat: 0, title: "Ada wins by forfeit", detail: cause === "model_error" ? "Bea forfeited after model errors." : "Bea forfeited after invalid actions." });
  });
  it("formats draws and decided outcomes without treating null as seat zero", () => {
    expect(resultText({ result: "draw", winnerSeat: null }, context.names).title).toBe("Draw");
    expect(resultText({ result: "decided", winnerSeat: 1 }, context.names).title).toBe("Bea wins");
    expect(resultText({ result: "forfeit", winnerSeat: null }, context.names).title).toBe("Match ended by forfeit");
    expect(formatEvent({ seq: 1, type: "seated", payload: { seat: 0, displayName: "Ada" } }, context).title).toBe("Joined the match");
  });
});

describe("timeline DOM", () => {
  it("makes the complete history card a named native button when selectable", () => {
    const document = new DocumentFixture();
    const select = vi.fn();
    const card = eventCard(document.asDocument(), action({ cell: "r2c3" }), context, select) as unknown as NodeFixture;
    const button = card.find("event-select")[0];
    expect(button.tagName).toBe("button");
    expect(button.type).toBe("button");
    expect(button.attributes["aria-label"]).toBe("Show position after #3: Bea, Placed X, r2c3");
    expect(button.find("event-marker")).toHaveLength(1);
    expect(button.find("event-content")).toHaveLength(1);
    expect(button.find("event-graphic")).toHaveLength(1);
    button.click();
    expect(select).toHaveBeenCalledWith(3);
  });

  it("renders untrusted names as text, provides CSS hooks and never displays raw payload JSON", () => {
    const document = new DocumentFixture();
    const name = '<img src=x onerror="alert(1)">';
    const event = { ...action({ cell: "r1c1" }), payload: { seat: 1, action: { cell: "r1c1" }, reasoning: "not provided to viewers", latency: 123 } };
    const card = eventCard(document.asDocument(), event, { ...context, names: { "1": name } }) as unknown as NodeFixture;
    expect(card.find("event-agent")[0].textContent).toBe(name);
    expect(card.tags("img")).toHaveLength(0);
    expect(card.className).toBe("event-item seat-1");
    for (const hook of ["event-marker", "event-content", "event-meta", "event-agent", "event-seq", "event-title", "event-detail", "event-coordinate", "event-graphic", "event-kind"]) expect(card.find(hook)).toHaveLength(1);
    expect(card.textContent).toContain("#3");
    expect(card.textContent).not.toMatch(/reasoning|latency|\{"|not provided/);
    expect(card.tags("svg")[0].attributes["aria-label"]).toContain("r1c1");
    expect(card.children.map((child) => child.className)).toEqual(["event-marker", "event-content", "event-graphic"]);
  });

  it("gives unknown events a readable fallback and does not expose their payload", () => {
    const document = new DocumentFixture();
    const card = eventCard(document.asDocument(), { seq: 8, type: "future_event", payload: { hidden: "do not show" } }, context) as unknown as NodeFixture;
    expect(card.textContent).toBe("MatchEvent#8Event recorded");
  });
});
