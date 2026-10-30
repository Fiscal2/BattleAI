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

export function page(input: { title: string; coachName?: string; body: string }): string {
  const account = input.coachName
    ? `<span class="who">${escapeHtml(input.coachName)}</span>
       <a class="ghost-link${input.title === "Agent" ? " current" : ""}" href="/agent"${input.title === "Agent" ? ' aria-current="page"' : ""}>Agent</a>
       <a class="ghost-link${input.title === "Matches" ? " current" : ""}" href="/matches"${input.title === "Matches" ? ' aria-current="page"' : ""}>Matches</a>
       <form method="post" action="/logout"><button class="pill pill-ghost" type="submit">Log out</button></form>`
    : `<a class="ghost-link" href="/login">Log in</a><a class="pill pill-primary" href="/register">Register</a>`;
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
  <main id="main" class="container">${input.body}</main>
</body>
</html>`;
}

export function field(
  label: string,
  name: string,
  value = "",
  options: { multiline?: boolean; type?: string } = {},
): string {
  const control = options.multiline
    ? `<textarea name="${name}" rows="6">${escapeHtml(value)}</textarea>`
    : `<input name="${name}" type="${options.type ?? "text"}" value="${escapeHtml(value)}">`;
  return `<label class="field"><span class="label-caps">${escapeHtml(label)}</span>${control}</label>`;
}
