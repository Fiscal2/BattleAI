import { brandGraphic } from "./graphics.js";

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&#39;";
    }
  });
}

export function page(input: { title: string; coachName?: string; body: string; authNext?: string }): string {
  const authNext = input.authNext ? `?next=${encodeURIComponent(input.authNext)}` : "";
  const rankings = `<a class="ghost-link${input.title === "Rankings" ? " current" : ""}" href="/rankings"${input.title === "Rankings" ? ' aria-current="page"' : ""}>Rankings</a>`;
  const account = input.coachName
    ? `<span class="who">${escapeHtml(input.coachName)}</span>
       <a class="ghost-link${input.title === "Agent" ? " current" : ""}" href="/agent"${input.title === "Agent" ? ' aria-current="page"' : ""}>Agent</a>
       <a class="ghost-link${input.title === "Matches" ? " current" : ""}" href="/matches"${input.title === "Matches" ? ' aria-current="page"' : ""}>Matches</a>
       ${rankings}
       <form method="post" action="/logout"><button class="pill pill-ghost" type="submit">Log out</button></form>`
    : `${rankings}<a class="ghost-link" href="/login${authNext}">Log in</a><a class="pill pill-primary" href="/register${authNext}">Register</a>`;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(input.title)}</title>
  <meta name="theme-color" content="#0a0a0a">
  <link rel="preload" href="/fonts/geist-400.woff2" as="font" type="font/woff2" crossorigin>
  <link rel="stylesheet" href="/app.css">
</head>
<body>
  <a class="skip-link" href="#main">Skip to content</a>
  <header class="top">
    <a class="brand-name" href="/">${brandGraphic}<span>BattleAI</span></a>
    <nav class="nav-actions" aria-label="Main navigation">${account}</nav>
  </header>
  <main id="main" class="container" tabindex="-1">${input.body}</main>
</body>
</html>`;
}

export function field(
  label: string,
  name: string,
  value = "",
  options: { multiline?: boolean; type?: string; describedBy?: string } = {},
): string {
  const control = options.multiline
    ? `<textarea name="${name}" rows="6">${escapeHtml(value)}</textarea>`
    : `<input name="${name}" type="${options.type ?? "text"}" value="${escapeHtml(value)}"${options.describedBy ? ` aria-describedby="${escapeHtml(options.describedBy)}"` : ""}>`;
  return `<label class="field"><span class="label-caps">${escapeHtml(label)}</span>${control}</label>`;
}

export function replayControls(seq: number): string {
  return `<section id="replay-controls" class="replay-controls" aria-label="Replay controls" tabindex="-1">
    <div class="replay-heading"><p id="replay-position" role="status">Latest position · #${seq}</p><span id="replay-unseen" class="count-badge" hidden></span></div>
    <label class="replay-seek-label"><span class="sr-only">Replay position</span><input id="replay-seek" type="range" min="0" max="${seq}" step="1" value="${seq}" aria-label="Replay position"></label>
    <div class="replay-actions"><div class="replay-transport">
      <button id="replay-prev" class="pill pill-ghost replay-step" type="button" aria-label="Previous event"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m12 5-5 5 5 5"/></svg></button>
      <button id="replay-play" class="pill pill-ghost" type="button">Play</button>
      <button id="replay-next" class="pill pill-ghost replay-step" type="button" aria-label="Next event"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m8 5 5 5-5 5"/></svg></button>
      <label class="replay-speed-label"><span class="sr-only">Playback speed</span><select id="replay-speed" aria-label="Playback speed"><option value="0.5">0.5×</option><option value="1" selected>1×</option><option value="2">2×</option></select><svg class="replay-speed-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="m4 6 4 4 4-4"/></svg></label>
    </div><button id="replay-live" class="pill pill-ghost" type="button">Return to live</button></div>
    <p id="replay-error" class="replay-error" role="status"></p>
  </section>`;
}
