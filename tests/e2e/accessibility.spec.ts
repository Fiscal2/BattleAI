import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

for (const theme of ["light", "dark"] as const) {
  for (const width of [1440, 390]) {
    for (const signedIn of [false, true]) {
      test(`${theme} ${width}px ${signedIn ? "coach" : "public"} pages pass accessibility and viewport checks`, async ({ page, context }) => {
        test.setTimeout(60_000);
        const { ids, sessions } = await (await page.request.get("/__test/fixtures")).json();
        await page.setViewportSize({ width, height: 1000 });
        await page.emulateMedia({ colorScheme: theme === "light" ? "dark" : "light" });
        await page.addInitScript(value => localStorage.setItem("battleai-theme", value), theme);
        if (signedIn) await context.addCookies([{ name: "session", value: sessions[0], url: "http://127.0.0.1:3108" }]);
        const routes = signedIn
          ? ["/agent", "/matches", ...["tic", "four", "checkers", "fleet"].map(game => `/matches/${ids[game]}`)]
          : ["/login", "/register", "/rankings"];
        for (const route of routes) {
          await page.goto(route);
          await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
          const toggle = page.getByRole("button", { name: "Dark mode", exact: true });
          await expect(toggle).toBeVisible();
          await expect(toggle).toHaveAttribute("aria-pressed", String(theme === "dark"));
          if (route === "/register") await expect(page.getByLabel("Password", { exact: true })).toHaveAccessibleDescription("Use at least 8 characters for your password.");
          await page.evaluate(() => document.fonts.ready);
          if (route.startsWith("/matches/")) await expect(page.locator(".event-select").first()).toBeVisible();
          const result = await new AxeBuilder({ page }).options({ rules: { "label-content-name-mismatch": { enabled: true } } }).analyze();
          expect(result.violations, `${theme} ${width}px ${route}: ${JSON.stringify(result.violations)}`).toEqual([]);
          if (width === 390) {
            const dimensions = await page.evaluate(() => ({
              viewport: document.documentElement.clientWidth,
              content: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
            }));
            expect(dimensions.content, `${theme} ${route} overflows the 390px viewport`).toBeLessThanOrEqual(dimensions.viewport);
          }
        }
      });
    }
  }
}

test("skip link transfers focus and replay works using only keyboard input", async ({ page }) => {
  const { ids } = await (await page.request.get("/__test/fixtures")).json();
  await page.goto(`/matches/${ids.tic}`);
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("main")).toBeFocused();
  for (let i = 0; i < 12 && !(await page.locator("#replay-seek").evaluate(node => node === document.activeElement)); i++) await page.keyboard.press("Tab");
  await expect(page.locator("#replay-seek")).toBeFocused();
  await page.keyboard.press("Home");
  await expect(page.locator("#replay-position")).toHaveText("Before the match");
  await page.keyboard.press("ArrowRight");
  await expect(page.locator("#replay-position")).toHaveText("Position after #1");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Previous event" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#replay-seek")).toBeFocused();
  await expect(page.locator("#replay-position")).toHaveText("Before the match");
  await page.keyboard.press("End");
  await expect(page.locator("#replay-position")).toContainText("#8");
  await page.keyboard.press("ArrowLeft");
  await expect(page.locator("#replay-position")).toHaveText("Position after #7");
  for (let i = 0; i < 3; i++) await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Next event" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#replay-seek")).toBeFocused();
  await expect(page.locator("#replay-position")).toContainText("#8");
  for (let i = 0; i < 4; i++) await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Return to latest" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#replay-seek")).toBeFocused();
});
