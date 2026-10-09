import type { GameId } from "../rules/types.js";

/** Decorative game geometry; the live position is rendered separately. */
export function gameGraphic(game: GameId): string {
  let shapes = "";
  if (game === "tictactoe") {
    shapes = '<path d="M24 8v48M40 8v48M8 24h48M8 40h48" opacity=".25"/><path d="m12 12 8 8m0-8-8 8m32 24 8 8m0-8-8 8"/><circle cx="32" cy="32" r="5"/>';
  } else if (game === "four") {
    for (let row = 0; row < 4; row++) {
      for (let col = 0; col < 5; col++) {
        const filled = col === 2 || (row === 3 && col === 1);
        shapes += `<circle cx="${12 + col * 10}" cy="${17 + row * 10}" r="3.2" ${filled ? 'fill="currentColor"' : 'opacity=".25"'}/>`;
      }
    }
  } else if (game === "checkers") {
    for (let row = 0; row < 4; row++) {
      for (let col = 0; col < 4; col++) {
        if ((row + col) % 2) shapes += `<rect x="${12 + col * 10}" y="${12 + row * 10}" width="10" height="10" fill="currentColor" opacity=".15" stroke="none"/>`;
      }
    }
    shapes += '<circle cx="27" cy="17" r="3.5"/><circle cx="37" cy="47" r="3.5"/><path d="m27 25 10 10m-5-1 5 1-1-5"/>';
  } else {
    shapes = '<path d="M16 12v40M32 12v40M48 12v40M12 16h40M12 32h40M12 48h40" opacity=".2"/><rect x="12" y="12" width="8" height="24" rx="3" fill="currentColor" stroke="none"/><circle cx="40" cy="40" r="7"/><path d="M40 29v5m0 12v5m-11-11h5m12 0h5"/>';
  }
  return `<svg class="game-graphic" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${shapes}</svg>`;
}

export const brandGraphic = '<svg class="brand-mark" viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false"><path d="M3 3h7v7H3zm11 11h7v7h-7z" fill="currentColor"/><path d="M14 3h7v7h-7zM3 14h7v7H3z" stroke="currentColor" stroke-width="1.5"/></svg>';
