import { expect, test, type Page } from "@playwright/test";

type Theme = "light" | "dark";
const storageKey = "battleai-theme";

async function expectTheme(page: Page, theme: Theme) {
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
  const toggle = page.locator("#theme-toggle");
  await expect(toggle).toBeVisible();
  await expect(toggle).toHaveAccessibleName("Dark mode");
  await expect(toggle).toHaveAttribute("aria-pressed", String(theme === "dark"));
}

async function tabToToggle(page: Page) {
  const toggle = page.getByRole("button", { name: "Dark mode", exact: true });
  for (let i = 0; i < 20 && !(await toggle.evaluate(node => node === document.activeElement)); i++) {
    await page.keyboard.press("Tab");
  }
  await expect(toggle).toBeFocused();
}

async function observeInitialTheme(page: Page) {
  await page.addInitScript(() => {
    // Capture the theme when body content first becomes renderable, before load handlers.
    const observer = new MutationObserver(() => {
      if (!document.body) return;
      (window as typeof window & { themeAtBody?: string | null }).themeAtBody = document.documentElement.getAttribute("data-theme");
      observer.disconnect();
    });
    observer.observe(document, { childList: true, subtree: true });
  });
}

async function expectInitialTheme(page: Page, theme: Theme) {
  expect(await page.evaluate(() => (window as typeof window & { themeAtBody?: string | null }).themeAtBody)).toBe(theme);
}

for (const initial of ["light", "dark"] as const) {
  test(`OS ${initial} applies before body content and follows system changes without saving a choice`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: initial });
    await observeInitialTheme(page);
    await page.goto("/login");
    await expectInitialTheme(page, initial);
    await expectTheme(page, initial);
    const opposite = initial === "light" ? "dark" : "light";
    await page.emulateMedia({ colorScheme: opposite });
    await expectTheme(page, opposite);
    await page.emulateMedia({ colorScheme: initial });
    await expectTheme(page, initial);
    expect(await page.evaluate(key => localStorage.getItem(key), storageKey)).toBeNull();
  });

  test(`keyboard choice from ${initial} persists across navigation and reload and overrides the OS`, async ({ page }) => {
    const chosen = initial === "light" ? "dark" : "light";
    await page.emulateMedia({ colorScheme: initial });
    await observeInitialTheme(page);
    await page.goto("/login");
    await expectTheme(page, initial);
    const originalBackground = await page.locator("body").evaluate(node => getComputedStyle(node).backgroundColor);
    await tabToToggle(page);
    await page.keyboard.press("Enter");
    await expectTheme(page, chosen);
    await expect(page.locator("#theme-toggle")).toBeFocused();
    expect(await page.evaluate(key => localStorage.getItem(key), storageKey)).toBe(chosen);
    await expect.poll(() => page.locator("body").evaluate(node => getComputedStyle(node).backgroundColor)).not.toBe(originalBackground);
    await page.emulateMedia({ colorScheme: chosen });
    await page.emulateMedia({ colorScheme: initial });
    await expectTheme(page, chosen);
    await page.getByRole("link", { name: "Rankings", exact: true }).click();
    await expect(page).toHaveURL(/\/rankings$/);
    await expectInitialTheme(page, chosen);
    await expectTheme(page, chosen);
    await page.reload();
    await expectInitialTheme(page, chosen);
    await expectTheme(page, chosen);
    await tabToToggle(page);
    await page.keyboard.press("Space");
    await expectTheme(page, initial);
    expect(await page.evaluate(key => localStorage.getItem(key), storageKey)).toBe(initial);
    await page.reload();
    await expectTheme(page, initial);
  });
}

for (const invalid of ["", "system", "DARK"]) {
  test(`invalid stored preference ${JSON.stringify(invalid)} follows OS and can be replaced`, async ({ page }) => {
    await page.goto("/login");
    await page.evaluate(({ key, value }) => localStorage.setItem(key, value), { key: storageKey, value: invalid });
    await page.emulateMedia({ colorScheme: "dark" });
    await observeInitialTheme(page);
    await page.reload();
    await expectInitialTheme(page, "dark");
    await expectTheme(page, "dark");
    await page.emulateMedia({ colorScheme: "light" });
    await expectTheme(page, "light");
    await tabToToggle(page);
    await page.keyboard.press("Space");
    await expectTheme(page, "dark");
    expect(await page.evaluate(key => localStorage.getItem(key), storageKey)).toBe("dark");
    await page.reload();
    await expectTheme(page, "dark");
  });
}

for (const failure of ["access", "write"] as const) {
  test(`blocked storage ${failure} still supports OS changes and keyboard choice for the current page`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.addInitScript(mode => {
      const blocked = () => { throw new DOMException("Storage unavailable", "SecurityError"); };
      if (mode === "access") Object.defineProperty(window, "localStorage", { configurable: true, get: blocked });
      else Storage.prototype.setItem = blocked;
    }, failure);
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto("/login");
    await expectTheme(page, "light");
    await page.emulateMedia({ colorScheme: "dark" });
    await expectTheme(page, "dark");
    await tabToToggle(page);
    await page.keyboard.press("Enter");
    await expectTheme(page, "light");
    await page.emulateMedia({ colorScheme: "light" });
    await page.emulateMedia({ colorScheme: "dark" });
    await expectTheme(page, "light");
    await page.keyboard.press("Space");
    await expectTheme(page, "dark");
    await page.emulateMedia({ colorScheme: "light" });
    await expectTheme(page, "dark");
    // Without working persistence, a new document falls back to the current OS setting.
    await page.reload();
    await expectTheme(page, "light");
    await tabToToggle(page);
    await page.keyboard.press("Space");
    await expectTheme(page, "dark");
    expect(errors).toEqual([]);
  });
}

test("real tabs synchronize explicit choices and return to OS when the preference is removed or cleared", async ({ page, context }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/login");
  const other = await context.newPage();
  await other.emulateMedia({ colorScheme: "light" });
  await other.goto("/rankings");
  await expectTheme(page, "light");
  await expectTheme(other, "light");
  await page.getByRole("button", { name: "Dark mode", exact: true }).click();
  await expectTheme(other, "dark");
  await other.getByRole("button", { name: "Dark mode", exact: true }).click();
  await expectTheme(page, "light");
  await page.emulateMedia({ colorScheme: "dark" });
  await expectTheme(page, "light");
  await other.evaluate(key => localStorage.removeItem(key), storageKey);
  await expectTheme(page, "dark");
  await page.emulateMedia({ colorScheme: "light" });
  await expectTheme(page, "light");
  await other.evaluate(key => localStorage.setItem(key, "dark"), storageKey);
  await expectTheme(page, "dark");
  await other.evaluate(() => localStorage.setItem("unrelated-preference", "light"));
  await expectTheme(page, "dark");
  await other.evaluate(key => localStorage.setItem(key, "invalid"), storageKey);
  await expectTheme(page, "light");
  await other.evaluate(key => localStorage.setItem(key, "dark"), storageKey);
  await expectTheme(page, "dark");
  await other.evaluate(() => localStorage.clear());
  await expectTheme(page, "light");
  await page.emulateMedia({ colorScheme: "dark" });
  await expectTheme(page, "dark");
});

test("unavailable theme script leaves the toggle hidden and the login form usable", async ({ page }) => {
  await page.route("**/theme.js", route => route.abort());
  await page.goto("/login");
  await expect(page.locator("#theme-toggle")).toHaveCount(1);
  await expect(page.locator("#theme-toggle")).toBeHidden();
  await expect(page.getByLabel("Email", { exact: true })).toBeVisible();
});

test.describe("without JavaScript", () => {
  test.use({ javaScriptEnabled: false });

  test("theme toggle stays hidden while login and navigation remain usable", async ({ page }) => {
    await page.goto("/login");
    await expect(page.locator("#theme-toggle")).toHaveCount(1);
    await expect(page.locator("#theme-toggle")).toBeHidden();
    await expect(page.getByLabel("Email", { exact: true })).toBeVisible();
    await page.getByRole("link", { name: "Rankings", exact: true }).click();
    await expect(page).toHaveURL(/\/rankings$/);
    await expect(page.getByRole("heading", { name: "Rankings", exact: true })).toBeVisible();
    await expect(page.locator("#theme-toggle")).toBeHidden();
  });
});
