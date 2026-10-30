import { expect, test } from "@playwright/test";
const base = "http://127.0.0.1:3108";

test("a coach learns the fields, saves instructions, and snapshots remain fixed after joining", async ({ page, context }) => {
  const { sessions } = await (await page.request.get("/__test/fixtures")).json();
  await context.addCookies([{ name: "session", value: sessions[0], url: base }]);
  await page.goto("/agent");
  await expect(page.getByRole("textbox", { name: "Persona", exact: true })).toHaveAccessibleDescription(/temperament.*Example:/);
  await expect(page.getByRole("textbox", { name: "Playbook", exact: true })).toHaveAccessibleDescription(/concrete tactics.*Example:/);
  await expect(page.getByRole("textbox", { name: "Context", exact: true })).toHaveAccessibleDescription(/Manually add lessons.*Example:/);
  await page.getByText("Example tactics for each game", { exact: true }).focus();
  await page.keyboard.press("Enter");
  for (const game of ["Tic-tac-toe", "Four", "Checkers", "Fleet"]) await expect(page.locator("details dt", { hasText: game })).toBeVisible();
  const created = await page.request.post("/matches", { form: { gameId: "tictactoe" }, maxRedirects: 0 });
  const matchUrl = created.headers().location;
  await page.getByRole("textbox", { name: "Persona", exact: true }).fill("Patient <coach> & precise");
  await page.getByRole("textbox", { name: "Playbook", exact: true }).fill("Check immediate threats.");
  await page.getByRole("textbox", { name: "Context", exact: true }).fill("Review the last replay.");
  await page.getByRole("button", { name: "Save agent" }).click();
  await expect(page.getByRole("status")).toHaveText("Agent saved.");
  await page.reload();
  await expect(page.getByRole("textbox", { name: "Persona", exact: true })).toHaveValue("Patient <coach> & precise");
  const joined = await page.request.post(`${matchUrl}/join`, { headers: { cookie: `session=${sessions[1]}` }, maxRedirects: 0 });
  expect(joined.status()).toBe(303);
  await page.goto(matchUrl);
  await expect(page.locator(".snapshot").first()).toContainText("Patient <coach> & precise");
  await page.goto("/agent");
  await page.getByRole("textbox", { name: "Persona", exact: true }).fill("Later revision");
  await page.getByRole("button", { name: "Save agent" }).click();
  await page.goto(matchUrl);
  await expect(page.locator(".snapshot").first()).toContainText("Patient <coach> & precise");
  await expect(page.locator(".snapshot").first()).not.toContainText("Later revision");
  // Restore the shared fixture's coaching so the recovery/replay fixtures retain their meaning.
  await page.request.post("/agent", { form: { persona: "Patient", playbook: "Check threats", context: "browser-fixture" } });
});

test("public rankings count results, retain ties across pages, filter and explain forfeits", async ({ page }) => {
  await page.goto("/rankings?game=fleet");
  const rows = page.locator(".rankings-table tbody tr");
  await expect(rows).toHaveCount(50);
  await expect(rows.first()).toContainText("League 01");
  await expect(rows.first().locator("td")).toHaveText(["1", "1", "0", "0", "1", "100.0%", "0"]);
  await expect(page.locator("#ranking-method")).toContainText("model/provider-error forfeits");
  await page.getByRole("link", { name: "Next", exact: true }).click();
  await expect(page).toHaveURL(/game=fleet&page=2/);
  await expect(rows).toHaveCount(5);
  await expect(rows.first()).toContainText("League 51");
  await expect(rows.first().locator("td").first()).toHaveText("1");
  await expect(rows.last()).toContainText("League Bench");
  await expect(rows.last().locator("td")).toHaveText(["55", "0", "54", "0", "54", "0.0%", "2"]);
  await page.getByLabel("Game", { exact: true }).selectOption("four");
  await page.getByRole("button", { name: "Apply filter" }).click();
  await expect(page).toHaveURL(/game=four$/);
  await expect(rows).toHaveCount(2);
  await expect(rows.first().locator("td")).toHaveText(["1", "0", "0", "1", "1", "0.0%", "0"]);
  await page.getByLabel("Game", { exact: true }).selectOption("checkers");
  await page.getByRole("button", { name: "Apply filter" }).click();
  await expect(page.getByRole("heading", { name: "No finished matches yet" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Create a coach" })).toBeVisible();
  expect((await page.request.get("/rankings?game=unknown")).status()).toBe(400);
  expect((await page.request.get("/rankings?game=fleet&page=9")).status()).toBe(404);
});

test("signed-in phone navigation, table scrolling and Agent help remain usable", async ({ page, context }, info) => {
  const { sessions } = await (await page.request.get("/__test/fixtures")).json();
  await context.addCookies([{ name: "session", value: sessions[0], url: base }]);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  for (const width of [1440, 375]) {
    await page.setViewportSize({ width, height: width === 1440 ? 1000 : 812 });
    await page.goto("/agent");
    await expect(page.locator(".who")).toHaveJSProperty("tagName", "SPAN");
    await expect(page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: "Rankings" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    await page.screenshot({ path: info.outputPath(`agent-${width}.png`), fullPage: true });
    await page.getByRole("link", { name: "Rankings", exact: true }).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    await page.screenshot({ path: info.outputPath(`rankings-${width}.png`) });
    await page.getByLabel("Game", { exact: true }).selectOption("four");
    await page.getByRole("button", { name: "Apply filter" }).click();
    await expect(page.locator(".ranking-you")).toBeVisible();
    if (width === 375) {
      const region = page.getByRole("region", { name: "Ranking results" });
      await region.focus();
      await expect(region).toBeFocused();
      await expect(region).toHaveCSS("outline-style", "solid");
      for (let i = 0; i < 30; i++) await region.press("ArrowRight");
      await expect.poll(() => region.evaluate(node => node.scrollLeft)).toBeGreaterThan(0);
      await expect(page.getByRole("columnheader", { name: "Forfeits" })).toBeInViewport();
    }
  }
  expect(errors).toEqual([]);
});
