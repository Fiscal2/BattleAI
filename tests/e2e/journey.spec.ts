import { expect, test } from "@playwright/test";
const base = "http://127.0.0.1:3108";
type Fixtures = { ids: Record<string, string>; sessions: string[] };
let f: Fixtures;
test.beforeAll(async ({ request }) => { f = await (await request.post("/__test/journey/seed")).json(); });
test.afterAll(async ({ request }) => { await request.post("/__test/journey/reset"); });

test("find unfinished matches, copy invitations with success/manual fallback, and return through auth without joining", async ({ page, context }) => {
  await context.addCookies([{ name: "session", value: f.sessions[0], url: base }]);
  await page.goto("/matches");
  await expect(page.locator('section[aria-labelledby="matches-active"]')).toContainText("Resume");
  const invite = page.locator(`a.record[href="/matches/${f.ids.journeyInvitation}"]`);
  await expect(invite).toContainText("Share invitation");
  await invite.click();
  await expect(page.getByLabel("Match link", { exact: true })).toHaveValue(`${base}/matches/${f.ids.journeyInvitation}`);
  await page.evaluate(() => Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async () => {} } }));
  // Reload installs the helper with the replacement clipboard before testing copying.
  await page.addInitScript(() => Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (value: string) => { (window as unknown as { copied: string }).copied = value; } } }));
  await page.reload();
  await page.getByRole("button", { name: "Copy match link" }).click();
  await expect(page.locator("#copy-link-status")).toHaveText("Match link copied.");
  expect(await page.evaluate(() => (window as unknown as { copied: string }).copied)).toBe(`${base}/matches/${f.ids.journeyInvitation}`);
  await page.evaluate(() => { navigator.clipboard.writeText = async () => { throw new Error("denied"); }; });
  await page.getByRole("button", { name: "Copy match link" }).click();
  await expect(page.locator("#copy-link-status")).toContainText("copy it manually");
  await expect(page.getByLabel("Match link", { exact: true })).toBeFocused();
  expect(await page.getByLabel("Match link", { exact: true }).evaluate((node: HTMLInputElement) => node.selectionEnd! - node.selectionStart!)).toBe((await page.getByLabel("Match link", { exact: true }).inputValue()).length);
  await context.clearCookies();
  await page.reload();
  await expect(page.getByRole("link", { name: "Log in to join" })).toBeVisible();
  await page.getByRole("link", { name: "← Log in", exact: true }).click();
  await page.getByRole("link", { name: "Create a coach", exact: true }).click();
  await expect(page.locator('input[name="next"]')).toHaveValue(`/matches/${f.ids.journeyInvitation}`);
  await page.locator(".auth-switch").getByRole("link", { name: "Log in", exact: true }).click();
  await page.getByRole("textbox", { name: "Email", exact: true }).fill("coach-1@example.test");
  await page.getByLabel("Password", { exact: true }).fill("wrong-password");
  await page.getByRole("button", { name: "Log in", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Email or password is wrong");
  await page.getByRole("textbox", { name: "Email", exact: true }).fill("coach-1@example.test");
  await page.getByLabel("Password", { exact: true }).fill("browser-fixture-password");
  await page.getByRole("button", { name: "Log in", exact: true }).click();
  await expect(page).toHaveURL(`${base}/matches/${f.ids.journeyInvitation}`);
  await expect(page.locator("#match-status")).toHaveText("Waiting for opponent");
  await expect(page.getByRole("button", { name: "Join match", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Join match", exact: true }).click();
  await expect(page.locator("#match-status")).toHaveText("In progress");
  await page.goto("/matches");
  await expect(page.locator(`a.record[href="/matches/${f.ids.journeyInvitation}"]`)).toContainText("Resume");
});

test("historical consequences survive reload/reconnect, while selected winning lines follow the board", async ({ page, context }) => {
  await context.addCookies([{ name: "session", value: f.sessions[0], url: base }]);
  await page.goto(`/matches/${f.ids.journeyFleet}`);
  await expect(page.locator('.event-title', { hasText: "Sank a 3-cell ship" })).toHaveCount(2);
  await expect(page.locator('.event-item[data-seq="7"] .event-title')).toHaveText("Shot hit");
  await expect(page.locator("#summary-content")).toContainText("18 shots");
  await expect(page.locator("#summary-content")).toContainText("5 ships sunk");
  const reconnected = await page.evaluate(async id => {
    const abort = new AbortController();
    const response = await fetch(`/matches/${id}/events?after=6`, { headers: { "Last-Event-ID": "10" }, signal: abort.signal });
    const reader = response.body!.getReader(); let text = "";
    while (!text.includes('"type":"result"')) { const chunk = await reader.read(); if (chunk.done) break; text += new TextDecoder().decode(chunk.value); }
    abort.abort();
    return text.split("\n\n").filter(frame => frame.startsWith("id:")).map(frame => JSON.parse(frame.split("data: ")[1]).event);
  }, f.ids.journeyFleet);
  expect(reconnected[0].seq).toBe(11);
  expect(reconnected.filter(event => event.consequence?.sunkLength === 3)).toHaveLength(2);
  await page.reload();
  await expect(page.locator('.event-item[data-seq="7"] .event-title')).toHaveText("Shot hit");
  await page.goto(`/matches/${f.ids.journeyCapture}`);
  await expect(page.locator('.event-item[data-seq="12"] .event-title')).toHaveText("Captured 2 pieces");
  await expect(page.locator('.event-item[data-seq="12"] .event-detail')).toContainText("Promoted to king");
  await expect(page.locator('.event-item[data-seq="12"] .event-select')).toHaveAccessibleName(/Captured 2 pieces, Promoted to king/);
  await expect(page.locator("#summary-content")).toContainText("3 pieces captured");
  await expect(page.locator(".winning")).toHaveCount(0); // This match ended by forfeit.
  await page.goto(`/matches/${f.ids.journeyFour}`);
  await expect(page.locator(".four .winning")).toHaveCount(4);
  await page.locator('.event-item[data-seq="5"] .event-select').click();
  await expect(page.locator("#replay-position")).toHaveText("Position after #5");
  await expect(page.locator(".winning")).toHaveCount(0);
  await page.getByRole("button", { name: "Return to latest" }).click();
  await expect(page.locator(".four .winning")).toHaveCount(4);
});

test("a final summary appears on live completion during replay and supports edit then an opt-in rematch", async ({ page, context }) => {
  await context.addCookies([{ name: "session", value: f.sessions[1], url: base }]);
  await page.goto(`/matches/${f.ids.journeyLive}`);
  await expect(page.locator("#match-summary")).toBeHidden();
  await page.locator('.event-item[data-seq="2"] .event-select').click();
  await expect(page.locator("#replay-position")).toHaveText("Position after #2");
  for (let i = 0; i < 9; i++) await page.request.post("/__test/journey/step");
  await expect(page.locator("#connection-status")).toHaveText("Match complete");
  await expect(page.getByRole("heading", { name: "Final match summary" })).toBeVisible();
  await expect(page.locator("#replay-position")).toHaveText("Position after #2");
  await expect(page.locator(".winning")).toHaveCount(0);
  await page.getByRole("button", { name: "Return to latest" }).click();
  await expect(page.locator(".tic .winning")).toHaveCount(3);
  await page.getByRole("link", { name: "Edit agent", exact: true }).click();
  await page.getByRole("textbox", { name: "Persona", exact: true }).fill("Revised after replay");
  await page.getByRole("button", { name: "Save agent" }).click();
  await page.goto(`/matches/${f.ids.journeyLive}`);
  await expect(page.locator(".snapshot").nth(1)).not.toContainText("Revised after replay");
  await page.getByRole("button", { name: "Create rematch", exact: true }).click();
  expect(page.url()).not.toContain(f.ids.journeyLive);
  const rematch = new URL(page.url()).pathname;
  await expect(page.locator("#match-status")).toHaveText("Waiting for opponent");
  await expect(page.locator(".participant-name").nth(0)).toHaveText("Turing");
  await expect(page.locator(".participant-name").nth(1)).toHaveText("Open seat");
  await expect(page.locator(".event-item")).toHaveCount(1);
  await expect(page.locator("#connection-status")).toHaveText("Live");
  const joined = await page.request.post(`${rematch}/join`, { headers: { cookie: `session=${f.sessions[0]}` }, maxRedirects: 0 });
  expect(joined.status()).toBe(303);
  // The seated event reloads the waiting page; a second reload races that navigation.
  await expect(page.locator("#match-status")).toHaveText("In progress");
  await expect(page.locator(".snapshot").first()).toContainText("Revised after replay");
});

test("match discovery, invitations and final summaries fit desktop and phone", async ({ page, context }, info) => {
  await context.addCookies([{ name: "session", value: f.sessions[0], url: base }]);
  for (const width of [1440, 375]) {
    await page.setViewportSize({ width, height: width === 1440 ? 1000 : 812 });
    for (const [name, path] of [["matches", "/matches"], ["invitation", `/matches/${f.ids.waiting}`], ["summary", `/matches/${f.ids.journeyCapture}`]]) {
      await page.goto(path);
      await page.evaluate(() => document.fonts.ready);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
      if (name === "summary") await page.locator("#match-summary").scrollIntoViewIfNeeded();
      await page.screenshot({ path: info.outputPath(`${name}-${width}.png`) });
    }
  }
});
