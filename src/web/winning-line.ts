import { isSeat, type Seat, type View } from "./types.js";

const DIRECTIONS = [[0, 1], [1, 0], [1, 1], [1, -1]] as const;

// Keys use one-based rNcN coordinates; Four grid row 0 is r1, the bottom row.
export function winningLine(view: View | null, firstSeat: Seat | null | undefined): ReadonlySet<string> {
  const cells = new Set<string>();
  if (!view || !isSeat(firstSeat) || typeof view.outcome !== "object"
    || (view.game !== "tictactoe" && view.game !== "four")) return cells;

  const first = view.outcome.winner === firstSeat;
  const mark = view.game === "tictactoe" ? first ? "X" : "O" : first ? "A" : "B";
  const grid = view.game === "tictactoe"
    ? [view.cells.slice(0, 3), view.cells.slice(3, 6), view.cells.slice(6, 9)] : view.grid;
  const length = view.game === "tictactoe" ? 3 : 4;

  for (let row = 0; row < grid.length; row += 1) {
    for (let column = 0; column < grid[row].length; column += 1) {
      if (grid[row][column] !== mark) continue;
      for (const [rowStep, columnStep] of DIRECTIONS) {
        // Only scan from the beginning of a maximal run, retaining every cell of long lines.
        if (grid[row - rowStep]?.[column - columnStep] === mark) continue;
        const run: string[] = [];
        let nextRow = row;
        let nextColumn = column;
        while (grid[nextRow]?.[nextColumn] === mark) {
          run.push(`r${nextRow + 1}c${nextColumn + 1}`);
          nextRow += rowStep;
          nextColumn += columnStep;
        }
        if (run.length >= length) for (const cell of run) cells.add(cell);
      }
    }
  }
  return cells;
}
