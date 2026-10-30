import { describe, expect, it } from "vitest";
import { renderSummary, summaryTotals } from "../../src/web/summary.ts";
import type { ShownEvent } from "../../src/web/types.ts";
import { DocumentFixture } from "./dom.ts";
const action = (seq: number, seat: number, consequence?: ShownEvent["consequence"], value: unknown = { path: [9, 13] }): ShownEvent => ({ seq, type: "action", payload: { seat, action: value }, consequence });
describe("factual final summary", () => {
  it("counts recorded Checkers moves, captures and promotions by the acting seat, excluding non-actions", () => {
    const events = [action(3, 1, { captured: 2, promoted: true }), action(4, 0, { captured: 0, promoted: false }), { seq: 5, type: "result", payload: { winnerSeat: 1 } }];
    expect(summaryTotals("checkers", events)).toMatchObject([{ seat: 0, moves: 1, captures: 0, promotions: 0 }, { seat: 1, moves: 1, captures: 2, promotions: 1 }]);
  });
  it("counts Fleet shots, hit/miss and sunk ships without treating placement as a shot", () => {
    const events = [action(3, 0, undefined, { placed: true }), action(4, 1, undefined, { ships: [] }), action(5, 1, { hit: true, sunkLength: 3 }, { cell: "A3" }), action(6, 0, { hit: false }, { cell: "J10" })];
    expect(summaryTotals("fleet", events)).toMatchObject([{ seat: 0, shots: 1, hits: 0, misses: 1, sunk: 0 }, { seat: 1, shots: 1, hits: 1, misses: 0, sunk: 1 }]);
  });
  it("waits for a recorded result and renders malicious names as text, including a forfeit with zero moves", () => {
    const fixture = new DocumentFixture();
    const panel = fixture.mount("#match-summary", "section");
    const content = fixture.mount("#summary-content", "div");
    const names = { "0": "<img onerror=bad>", "1": "Bea" };
    renderSummary(fixture.asDocument(), "four", [], null, names);
    expect(panel.hidden).toBe(true);
    expect(content.textContent).toBe("");
    renderSummary(fixture.asDocument(), "four", [], { result: "forfeit", winnerSeat: 1, forfeitSeat: 0, forfeitCause: "invalid_action" }, names);
    expect(panel.hidden).toBe(false);
    expect(content.textContent).toContain("Bea wins by forfeit");
    expect(content.textContent).toContain("<img onerror=bad>");
    expect(content.tags("img")).toHaveLength(0);
    expect(content.textContent).toContain("0 recorded moves");
  });
});
