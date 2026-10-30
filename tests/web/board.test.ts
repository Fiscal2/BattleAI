import { describe, expect, it } from "vitest";
import { boardCaption, createBoardRenderer } from "../../src/web/board.ts";
import type { FeedContext, View } from "../../src/web/types.ts";
import { DocumentFixture } from "./dom.ts";

const context: FeedContext = { game: "fleet", names: { "0": "Ada", "1": "Bea" }, firstSeat: 1, view: null };
function render(view: View) {
  const document = new DocumentFixture();
  const board = document.createElement("div");
  const update = createBoardRenderer(board as unknown as HTMLElement, context);
  update(view);
  return { board, update };
}

describe("accessible public boards", () => {
  it("keeps unknown Fleet cells unrevealed and labels supplied hits, misses and visible ships on the correct ocean", () => {
    const view: Extract<View, { game: "fleet" }> = {
      game: "fleet", phase: "shoot", turn: 1, outcome: "ongoing", lastShot: { seat: 0, cell: "B1" },
      ships: [{ seat: 0, length: 2, cells: ["A1", "A2"], sunk: false }],
      shots: [{ seat: 0, cell: "B1", hit: true }, { seat: 1, cell: "C1", hit: false }],
    };
    const { board } = render(view);
    const [own, enemy] = board.find("fleet");
    expect(own.children[0].attributes["aria-label"]).toBe("Ada, A1: unshot, ship");
    expect(own.children[2].attributes["aria-label"]).toBe("Ada, C1: miss, no ship revealed");
    expect(enemy.children[0].attributes["aria-label"]).toBe("Bea, A1: unshot, no ship revealed");
    expect(enemy.children[0].className).toBe("square");
    expect(enemy.children[0].textContent).toBe("");
    expect(enemy.children[1].attributes["aria-label"]).toBe("Bea, B1: hit, no ship revealed");
    expect(enemy.children[1].className).toContain("last");
    expect(own.style.gridTemplateColumns).toBe("repeat(10, minmax(0, 1fr))");
  });

  it("labels Four rows from the bottom and assigns A to the actual first seat", () => {
    const grid = Array.from({ length: 6 }, () => Array(7).fill(null));
    grid[0][6] = "A";
    const { board } = render({ game: "four", grid, turn: 0, last: { row: 0, column: 7 }, outcome: "ongoing" });
    const cells = board.find("square");
    expect(cells[0].attributes["aria-label"]).toBe("Column 1, row 6: empty");
    expect(cells[41].attributes["aria-label"]).toBe("Column 7, row 1: A disc, Bea");
    expect(cells[41].className).toContain("last");
    expect(board.find("disc")[0].className).toContain("seat-1");
    expect(board.find("board-legend")[0].textContent).toBe("Ada · BBea · A");
  });

  it("labels Checkers square numbers, coordinates and real king state", () => {
    const { board } = render({ game: "checkers", pieces: { "1": "red-king", "32": "white-man" }, turn: 1, lastPath: [5, 1], outcome: "ongoing" });
    expect(board.find("square")[1].attributes["aria-label"]).toBe("Row 1, column 2, square 1: red king, Bea");
    expect(board.find("square")[0].attributes["aria-label"]).toBe("Row 1, column 1: unplayable");
    expect(board.find("square")[62].attributes["aria-label"]).toBe("Row 8, column 7, square 32: white man, Ada");
    expect(board.find("piece")[0].textContent).toBe("K");
  });

  it("updates captions without replacing unchanged cells and renders actual outcomes", () => {
    const view: Extract<View, { game: "tictactoe" }> = { game: "tictactoe", cells: Array(9).fill(null), turn: 1, lastCell: null, outcome: "ongoing" };
    const { board, update } = render(view);
    const grid = board.find("tic")[0];
    update({ ...view, turn: 0 });
    expect(board.find("tic")[0]).toBe(grid);
    expect(board.find("board-caption")[0].textContent).toBe("Ada to move");
    expect(boardCaption({ ...view, outcome: "draw" }, context)).toBe("Draw");
    expect(boardCaption({ ...view, outcome: { winner: 1 } }, context)).toBe("Bea wins");
    expect(boardCaption(view, context, null, true)).toBe("Match finished");
  });
});
