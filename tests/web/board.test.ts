import { describe, expect, it } from "vitest";
import { boardCaption, createBoardRenderer } from "../../src/web/board.ts";
import type { FeedContext, View } from "../../src/web/types.ts";
import { DocumentFixture } from "./dom.ts";

const context: FeedContext = { game: "fleet", names: { "0": "Ada", "1": "Bea" }, firstSeat: 1, view: null };
function render(view: View, rendererContext: FeedContext = context) {
  const document = new DocumentFixture();
  const board = document.createElement("div");
  const update = createBoardRenderer(board as unknown as HTMLElement, rendererContext);
  update(view);
  return { board, update };
}

describe("accessible public boards", () => {
  it("prints Fleet axes on each ocean without adding squares or revealing hidden cells", () => {
    const { board } = render({ game: "fleet", phase: "place", turn: 1, outcome: "ongoing", ships: [], shots: [], lastShot: null });
    const oceans = board.find("coordinate-board");
    expect(oceans).toHaveLength(2);
    for (const ocean of oceans) {
      expect(ocean.find("coordinate-columns")[0].children.map((label) => label.textContent))
        .toEqual(["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"]);
      expect(ocean.find("coordinate-rows")[0].children.map((label) => label.textContent))
        .toEqual(["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"]);
      expect(ocean.find("coordinate-columns")[0].attributes["aria-hidden"]).toBe("true");
      expect(ocean.find("coordinate-rows")[0].attributes["aria-hidden"]).toBe("true");
      expect(ocean.style.width).toBe("100%");
      expect(ocean.style.minWidth).toBe("0");
      expect(ocean.style.maxWidth).toBe("356px");
      expect(ocean.find("fleet")[0].children).toHaveLength(100);
    }
    expect(board.find("square")).toHaveLength(200);
    expect(board.find("square").every((cell) => cell.textContent === "" && cell.className === "square")).toBe(true);
  });

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
    expect(board.find("coordinate-columns")[0]?.children.map((label) => label.textContent))
      .toEqual(["1", "2", "3", "4", "5", "6", "7"]);
    expect(board.find("coordinate-rows")).toHaveLength(0);
    const cells = board.find("square");
    expect(cells).toHaveLength(42);
    expect(cells[0].attributes["aria-label"]).toBe("Column 1, row 6: empty");
    expect(cells[41].attributes["aria-label"]).toBe("Column 7, row 1: A disc, Bea");
    expect(cells[41].className).toContain("last");
    expect(board.find("disc")[0].className).toContain("seat-1");
    expect(board.find("board-legend")[0].textContent).toBe("Ada · BBea · A");
  });

  it("labels Checkers square numbers, coordinates and real king state", () => {
    const { board } = render({ game: "checkers", pieces: { "1": "red-king", "32": "white-man" }, turn: 1, lastPath: [5, 1], outcome: "ongoing" });
    expect(board.find("square")).toHaveLength(64);
    expect(board.find("square-coordinate").map((label) => label.textContent)).toEqual([
      "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13", "14", "15", "16",
      "17", "18", "19", "20", "21", "22", "23", "24", "25", "26", "27", "28", "29", "30", "31", "32",
    ]);
    for (const cell of board.find("playable")) {
      const label = cell.find("square-coordinate")[0];
      expect(cell.attributes["aria-label"]).toContain(`square ${label.textContent}:`);
      expect(label.attributes["aria-hidden"]).toBe("true");
    }
    expect(board.find("light").every((cell) => cell.find("square-coordinate").length === 0)).toBe(true);
    expect(board.find("square")[1].attributes["aria-label"]).toBe("Row 1, column 2, square 1: red king, Bea");
    expect(board.find("square")[0].attributes["aria-label"]).toBe("Row 1, column 1: unplayable");
    expect(board.find("square")[62].attributes["aria-label"]).toBe("Row 8, column 7, square 32: white man, Ada");
    expect(board.find("piece")[0].textContent).toBe("K");
  });

  it("updates captions without replacing unchanged cells and renders actual outcomes", () => {
    const view: Extract<View, { game: "tictactoe" }> = { game: "tictactoe", cells: Array(9).fill(null), turn: 1, lastCell: null, outcome: "ongoing" };
    const { board, update } = render(view);
    const grid = board.find("tic")[0];
    const axes = board.find("coordinate-columns")[0];
    update({ ...view, turn: 0 });
    expect(board.find("tic")[0]).toBe(grid);
    expect(board.find("coordinate-columns")[0]).toBe(axes);
    expect(board.find("board-caption")[0].textContent).toBe("Ada to move");
    expect(boardCaption({ ...view, outcome: "draw" }, context)).toBe("Draw");
    expect(boardCaption({ ...view, outcome: { winner: 1 } }, context)).toBe("Bea wins");
    expect(boardCaption(view, context, null, true)).toBe("Match finished");
  });

  it("prints Tic row and column names that map directly to the existing cell labels", () => {
    const { board } = render({ game: "tictactoe", cells: ["X", null, null, null, "O", null, null, null, "X"], turn: 0, lastCell: "r3c3", outcome: "ongoing" });
    expect(board.find("coordinate-columns")[0]?.children.map((label) => label.textContent)).toEqual(["c1", "c2", "c3"]);
    expect(board.find("coordinate-rows")[0]?.children.map((label) => label.textContent)).toEqual(["r1", "r2", "r3"]);
    expect(board.find("square")).toHaveLength(9);
    expect(board.find("tic")[0].children.map((cell) => cell.attributes["aria-label"].split(":")[0]))
      .toEqual(["r1c1", "r1c2", "r1c3", "r2c1", "r2c2", "r2c3", "r3c1", "r3c2", "r3c3"]);
    expect(board.find("square")[0].textContent).toBe("X");
    expect(board.find("square")[4].textContent).toBe("O");
    expect(board.find("square")[8].className).toContain("last");
  });

  it("keeps coordinates and seat labels correct when mutable context switches to a historical view", () => {
    const live: Extract<View, { game: "tictactoe" }> = {
      game: "tictactoe", cells: ["X", null, null, null, null, null, null, null, null], turn: 0, lastCell: "r1c1", outcome: "ongoing",
    };
    const rendererContext: FeedContext = { ...context, names: { ...context.names }, view: live };
    const { board, update } = render(live, rendererContext);
    expect(board.find("square")[0].attributes["aria-label"]).toBe("r1c1: X, Bea");
    rendererContext.firstSeat = 0;
    rendererContext.names["0"] = "Historical Ada";
    const historical = { ...live, cells: Array(9).fill(null), lastCell: null };
    rendererContext.view = historical;
    update(historical);
    expect(board.find("square")[0].attributes["aria-label"]).toBe("r1c1: empty");
    expect(board.find("square")[0].textContent).toBe("");
    expect(board.find("last")).toHaveLength(0);
    expect(board.find("coordinate-columns")[0].textContent).toBe("c1c2c3");
    expect(board.find("coordinate-rows")[0].textContent).toBe("r1r2r3");
    update(live);
    expect(board.find("square")[0].attributes["aria-label"]).toBe("r1c1: X, Historical Ada");
    expect(board.find("square")[0].className).toContain("seat-0");
    update(null);
    expect(board.find("coordinate-board")).toHaveLength(0);
    update(historical);
    expect(board.find("coordinate-board")).toHaveLength(1);
    expect(board.find("square")).toHaveLength(9);
  });

  it("highlights every cell of intersecting Tic wins while preserving coordinates and last move", () => {
    const { board } = render({
      game: "tictactoe", cells: ["X", "O", "X", "O", "X", "O", "X", "O", "X"],
      turn: null, lastCell: "r2c2", outcome: { winner: 1 },
    });
    expect(board.find("winning").map((cell) => cell.attributes["aria-label"]))
      .toEqual(["r1c1", "r1c3", "r2c2", "r3c1", "r3c3"].map((id) => `${id}: X, Bea, winning line`));
    expect(board.find("winning").every((cell) => cell.className.includes("seat-1"))).toBe(true);
    expect(board.find("last")[0].attributes["aria-label"]).toBe("r2c2: X, Bea, winning line");
    expect(board.find("square")).toHaveLength(9);
    expect(board.find("coordinate-columns")[0].attributes["aria-hidden"]).toBe("true");
    expect(board.find("coordinate-rows")[0].attributes["aria-hidden"]).toBe("true");
  });

  it("highlights the full Four run on the bottom row using the winner's actual side", () => {
    const grid = Array.from({ length: 6 }, () => Array<"A" | "B" | null>(7).fill(null));
    grid[0] = ["B", "B", "B", "B", "B", null, null];
    grid[1] = ["A", "A", "A", null, null, null, null];
    const { board } = render({ game: "four", grid, turn: null, last: { row: 0, column: 3 }, outcome: { winner: 0 } });
    expect(board.find("winning").map((cell) => cell.attributes["aria-label"]))
      .toEqual([1, 2, 3, 4, 5].map((column) => `Column ${column}, row 1: B disc, Ada, winning line`));
    expect(board.find("winning").every((cell) => cell.find("disc")[0].className.includes("seat-0"))).toBe(true);
    expect(board.find("square")).toHaveLength(42);
    expect(board.find("square")[0].attributes["aria-label"]).toBe("Column 1, row 6: empty");
    expect(board.find("square")[40].attributes["aria-label"]).toBe("Column 6, row 1: empty");
    expect(board.find("last")[0].className).toContain("winning");
  });

  it.each(["tictactoe", "four"] as const)("refreshes %s highlights on outcome changes but reuses cells for caption-only changes", (game) => {
    const view: View = game === "tictactoe"
      ? { game, cells: ["X", "X", "X", null, null, null, null, null, null], turn: 0, lastCell: "r1c3", outcome: "ongoing" }
      : { game, grid: [["A", "A", "A", "A", null, null, null], ...Array.from({ length: 5 }, () => Array(7).fill(null))], turn: 0, last: { row: 0, column: 4 }, outcome: "ongoing" };
    const { board, update } = render(view);
    const original = board.find(game === "four" ? "four" : "tic")[0];
    expect(board.find("winning")).toHaveLength(0);
    const won: View = { ...view, turn: null, outcome: { winner: 1 } };
    update(won);
    const winningGrid = board.find(game === "four" ? "four" : "tic")[0];
    expect(winningGrid).not.toBe(original);
    expect(board.find("winning")).toHaveLength(game === "four" ? 4 : 3);
    update(won, { result: "decided", winnerSeat: 1, forfeitSeat: null, forfeitCause: "" }, true);
    expect(board.find(game === "four" ? "four" : "tic")[0]).toBe(winningGrid);
    expect(board.find("square")[0]).toBe(winningGrid.children[0]);
    update({ ...won, outcome: "draw" });
    expect(board.find("winning")).toHaveLength(0);
    expect(board.find("square").every((cell) => !cell.attributes["aria-label"].includes(", winning line"))).toBe(true);
    const drawnGrid = board.find(game === "four" ? "four" : "tic")[0];
    update(view);
    expect(board.find(game === "four" ? "four" : "tic")[0]).toBe(drawnGrid);
  });

  it.each(["tictactoe", "four"] as const)("clears %s winning cells for early history and never derives them from a forfeit result", (game) => {
    const view: View = game === "tictactoe"
      ? { game, cells: ["X", "X", "X", "O", "O", null, null, null, null], turn: null, lastCell: "r1c3", outcome: { winner: 1 } }
      : { game, grid: [["A", "A", "A", "A", "B", "B", null], ...Array.from({ length: 5 }, () => Array(7).fill(null))], turn: null, last: { row: 0, column: 4 }, outcome: { winner: 1 } };
    const rendererContext: FeedContext = { ...context, view };
    const { board, update } = render(view, rendererContext);
    expect(board.find("winning")).toHaveLength(game === "four" ? 4 : 3);
    const historical: View = view.game === "tictactoe"
      ? { ...view, cells: ["X", "X", null, "O", null, null, null, null, null], turn: 0, lastCell: "r1c2", outcome: "ongoing" }
      : { ...view, grid: [["A", "A", "A", null, "B", "B", null], ...Array.from({ length: 5 }, () => Array(7).fill(null))], turn: 0, last: { row: 0, column: 3 }, outcome: "ongoing" };
    // Context can still refer to the live winner while replay displays an earlier view.
    update(historical, { result: "forfeit", winnerSeat: 1, forfeitSeat: 0, forfeitCause: "timeout" }, true);
    expect(board.find("winning")).toHaveLength(0);
    expect(board.find("square").every((cell) => !cell.attributes["aria-label"].includes(", winning line"))).toBe(true);
    update({ ...view, outcome: "ongoing" }, { result: "forfeit", winnerSeat: 1, forfeitSeat: 0, forfeitCause: "timeout" }, true);
    expect(board.find("winning")).toHaveLength(0);
    update(view);
    expect(board.find("winning")).toHaveLength(game === "four" ? 4 : 3);
  });
});
