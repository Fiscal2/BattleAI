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
       <a class="ghost-link" href="/agent">Agent</a>
       <a class="ghost-link" href="/matches">Matches</a>
       <form method="post" action="/logout"><button class="pill pill-ghost" type="submit">Log out</button></form>`
    : `<a class="ghost-link" href="/login">Log in</a><a class="pill pill-primary" href="/register">Register</a>`;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(input.title)}</title>
  <link rel="stylesheet" href="/app.css">
</head>
<body>
  <header class="top">
    <a class="brand-name" href="/">BattleAI</a>
    <div class="nav-actions">${account}</div>
  </header>
  <main class="container">${input.body}</main>
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
