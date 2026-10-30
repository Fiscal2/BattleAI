import { expect, test, type Page } from "@playwright/test";

const base = "http://127.0.0.1:3108";
type Fixtures = { ids: Record<string, string>; sessions: string[]; recoveryCalls: number };
async function fixtures(page: Page): Promise<Fixtures> {
  return (await page.request.get("/__test/fixtures")).json();
}
async function inspect(page: Page, seq: number) {
  const card = page.locator(`.event-item[data-seq="${seq}"]`);
  await card.scrollIntoViewIfNeeded();
  await card.locator(".event-select").click();
  await expect(page.locator("#replay-position")).toHaveText(`Position after #${seq}`);
}
async function seek(page: Page, seq: number) {
  const slider = page.getByRole("slider", { name: "Replay position" });
  await slider.focus();
  await slider.press("Home");
  for (let i = 0; i < seq; i++) await slider.press("ArrowRight");
  await expect(page.locator("#replay-position")).toHaveText(seq ? `Position after #${seq}` : "Before the match");
}

test("completed replay supports action selection, keyboard seeking, transport and forfeit history", async ({ page }) => {
  const { ids } = await fixtures(page);
  await page.goto(`/matches/${ids.tic}`);
  await inspect(page, 3);
  await expect(page.locator(".tic .square").filter({ hasText: "X" })).toHaveCount(1);
  await expect(page.locator(".board-caption")).not.toContainText("wins");
  await expect(page.locator('.event-item[data-seq="3"] .event-select')).toHaveAttribute("aria-current", "step");
  await page.getByRole("button", { name: "Next event" }).click();
  await expect(page.locator("#replay-position")).toHaveText("Position after #4");
  await page.getByRole("button", { name: "Previous event" }).click();
  await expect(page.locator("#replay-position")).toHaveText("Position after #3");
  await seek(page, 0);
  await expect(page.locator(".board-caption")).toHaveText("Waiting for the second coach.");
  await page.getByRole("button", { name: "Return to latest" }).click();
  await expect(page.locator(".board-caption")).toContainText("wins");
  await page.getByRole("combobox", { name: "Playback speed" }).selectOption("2");
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect(page.locator("#replay-position")).toHaveText("Before the match");
  await expect(page.locator("#replay-position")).toHaveText("Position after #8", { timeout: 10_000 });
  await expect(page.getByRole("button", { name: "Play", exact: true })).toHaveAttribute("aria-pressed", "false");
  await page.goto(`/matches/${ids.forfeit}`);
  await expect(page.locator(".board-caption")).toContainText("Turing wins by forfeit");
  await inspect(page, 2);
  await expect(page.locator(".board-caption")).not.toContainText("forfeit");
  await expect(page.locator(".tic .square")).toHaveCount(9);
});

test("live events keep arriving while history is inspected, then catch up without duplicates", async ({ page }) => {
  const { ids } = await fixtures(page);
  await page.goto(`/matches/${ids.live}`);
  await expect(page.locator("#connection-status")).toHaveText("Live");
  await page.request.post("/__test/live/step");
  await expect(page.locator('.event-item[data-seq="3"]')).toHaveCount(1);
  await seek(page, 2);
  await page.request.post("/__test/live/step");
  await expect(page.locator("#event-count")).toHaveText("4");
  await expect(page.locator("#replay-position")).toHaveText("Position after #2");
  await expect(page.locator(".tic .square").filter({ hasText: /X|O/ })).toHaveCount(0);
  await expect(page.locator("#replay-unseen")).toBeVisible();
  await page.getByRole("button", { name: "Return to live" }).click();
  await expect(page.locator(".tic .square").filter({ hasText: /X|O/ })).toHaveCount(2);
  await expect(page.locator("#replay-unseen")).toBeHidden();
  for (let i = 0; i < 7; i++) await page.request.post("/__test/live/step");
  await expect(page.locator("#connection-status")).toHaveText("Match complete");
  const sequences = await page.locator(".event-item").evaluateAll(nodes => nodes.map(node => (node as HTMLElement).dataset.seq));
  expect(new Set(sequences).size).toBe(sequences.length);
});

test("rapid selections and failed history requests preserve the displayed position", async ({ page }) => {
  const { ids } = await fixtures(page);
  await page.goto(`/matches/${ids.tic}`);
  let release!: () => void;
  let entered!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { entered = resolve; });
  await page.route("**/position?seq=3", async route => {
    const response = await route.fetch();
    entered();
    await gate;
    await route.fulfill({ response }).catch(() => {}); // The browser may have canceled the old selection.
  });
  await page.locator('.event-item[data-seq="3"] .event-select').click();
  await started;
  await inspect(page, 4);
  release();
  await expect(page.locator("#replay-position")).toHaveText("Position after #4");
  await page.route("**/position?seq=2", route => route.fulfill({ status: 503, body: "Unavailable" }));
  await page.locator('.event-item[data-seq="2"] .event-select').click();
  await expect(page.locator("#replay-error")).toContainText("Could not load this position");
  await expect(page.locator("#replay-position")).toHaveText("Position after #4");
  await expect(page.locator(".tic .square").filter({ hasText: /X|O/ })).toHaveCount(2);
  await page.unroute("**/position?seq=2");
  await inspect(page, 2);
  await expect(page.locator("#replay-error")).toBeEmpty();
  await page.getByRole("button", { name: "Return to latest" }).click();
  await expect(page.locator("#replay-position")).toHaveText("Latest position after #8");
});

test("Fleet replay never leaks future sunk ships into an earlier seat view", async ({ page, context }) => {
  const { ids, sessions } = await fixtures(page);
  for (const seat of [0, 1]) {
    await context.clearCookies();
    await context.addCookies([{ name: "session", value: sessions[seat], url: base }]);
    await page.goto(`/matches/${ids.fleet}`);
    await inspect(page, 4);
    const oceans = page.locator(".oceans > div");
    await expect(oceans.nth(seat).locator(".ship")).toHaveCount(17);
    await expect(oceans.nth(1 - seat).locator(".ship, .sunk")).toHaveCount(0);
    await expect(page.locator(".hit, .miss")).toHaveCount(0);
    await expect(page.locator(".coordinate-columns .coordinate-label")).toHaveText([..."ABCDEFGHIJ", ..."ABCDEFGHIJ"]);
    await expect(page.locator(".coordinate-rows .coordinate-label")).toHaveText([...Array(10)].map((_,i)=>String(i+1)).concat([...Array(10)].map((_,i)=>String(i+1))));
  }
  await context.clearCookies();
  await page.reload();
  await inspect(page, 4);
  await expect(page.locator(".ship")).toHaveCount(34);
  const response = await page.request.get(`/matches/${ids.fleet}/position?seq=4`);
  expect(response.headers()["cache-control"]).toContain("no-store");
});

test("Four and Checkers coordinate labels match the inspected board", async ({ page }) => {
  const { ids } = await fixtures(page);
  await page.goto(`/matches/${ids.four}`);
  await inspect(page, 5);
  await expect(page.locator(".coordinate-columns .coordinate-label")).toHaveText(["1", "2", "3", "4", "5", "6", "7"]);
  await expect(page.locator(".four .disc")).toHaveCount(3);
  await expect(page.locator(".four .last")).toHaveAttribute("aria-label", /Column 4, row 2/);
  await page.goto(`/matches/${ids.checkers}`);
  await inspect(page, 3);
  await expect(page.locator(".square-coordinate")).toHaveText([...Array(32)].map((_,i)=>String(i+1)));
  await expect(page.locator(".checkers .square")).toHaveCount(64);
  await expect(page.locator(".checkers .piece")).toHaveCount(24);
});

test("waiting inspection survives a join and refreshes authoritative participants on return", async ({ page }) => {
  const { ids, sessions } = await fixtures(page);
  await page.goto(`/matches/${ids.waiting}`);
  await expect(page.locator("#connection-status")).toHaveText("Live");
  await seek(page, 0);
  const joined = await page.request.post(`/matches/${ids.waiting}/join`, { headers: { cookie: `session=${sessions[1]}` }, maxRedirects: 0 });
  expect(joined.status()).toBe(303);
  await expect(page.locator("#event-count")).toHaveText("2");
  await expect(page.locator("#replay-position")).toHaveText("Before the match");
  await expect(page.locator(".board-caption")).toHaveText("Waiting for the second coach.");
  await page.getByRole("button", { name: "Return to live" }).click();
  await expect(page.locator("h1")).toContainText("Turing");
  await expect(page.locator(".snapshot")).toHaveCount(2);
  await expect(page.locator(".oceans")).toHaveCount(1);
});

test("a connected spectator observes failure, then refresh recovers one runner", async ({ page }) => {
  const { ids } = await fixtures(page);
  await page.goto(`/matches/${ids.recovery}`);
  await expect(page.locator("#connection-status")).toHaveText("Live");
  await page.request.post("/__test/recovery/fail");
  await expect(page.locator("#connection-status")).toHaveText("Play paused. Reload to retry.");
  await expect(page.locator("#match-status")).toHaveText("Play paused. Reload to retry.");
  await expect(page.locator("body")).not.toContainText("private provider error");
  await Promise.all([page.reload(), page.request.get(`/matches/${ids.recovery}`)]);
  await expect(page.locator("#connection-status")).toHaveText("Live");
  expect((await fixtures(page)).recoveryCalls).toBe(2);
  await page.request.post("/__test/recovery/release");
  await expect(page.locator('.event-item[data-seq="3"]')).toHaveCount(1);
  await expect(page.locator(".tic .square").filter({ hasText: "X" })).toHaveCount(1);
});

test("desktop and phone layouts retain coordinates and keyboard-accessible controls", async ({ page }, info) => {
  const { ids } = await fixtures(page);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  for (const width of [1440, 375]) {
    await page.setViewportSize({ width, height: width === 1440 ? 1000 : 812 });
    for (const game of ["tic", "four", "checkers", "fleet"]) {
      await page.goto(`/matches/${ids[game]}`);
      await expect(page.locator(".grid").first()).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
      const card = page.locator(".event-item").first();
      const cardWidth = await card.evaluate(node => node.getBoundingClientRect().width);
      const buttonWidth = await card.locator(".event-select").evaluate(node => node.getBoundingClientRect().width);
      expect(buttonWidth).toBeGreaterThan(cardWidth * 0.9);
      await expect(page.getByRole("button", { name: "Previous event" })).toBeVisible();
      await page.screenshot({ path: info.outputPath(`${game}-${width}.png`), fullPage: true });
    }
    if (width === 375) {
      await page.locator(".mobile-board-link").scrollIntoViewIfNeeded();
      await page.locator(".mobile-board-link").click();
      await expect(page.locator("#replay-controls")).toBeInViewport();
    }
  }
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(page.locator(".event-item").last()).toHaveCSS("animation-name", "none");
  expect(errors).toEqual([]);
});

test("replay controls reserve space for the speed arrow inside the pill", async ({ page }, info) => {
  const { ids } = await fixtures(page);
  for (const width of [375, 560, 800, 1440]) {
    await page.setViewportSize({ width, height: 752 });
    await page.goto(`/matches/${ids.tic}`);
    const speed = page.getByRole("combobox", { name: "Playback speed" });
    const icon = page.locator(".replay-speed-icon");
    await expect(icon).toBeVisible();
    for (const value of ["0.5", "1", "2"]) {
      await speed.selectOption(value);
      const bounds = await speed.boundingBox();
      const arrow = await icon.boundingBox();
      expect(bounds).not.toBeNull(); expect(arrow).not.toBeNull();
      expect(arrow!.x - bounds!.x).toBeGreaterThanOrEqual(8);
      expect(bounds!.x + bounds!.width - arrow!.x - arrow!.width).toBeGreaterThanOrEqual(8);
      expect(arrow!.y - bounds!.y).toBeGreaterThanOrEqual(8);
      expect(bounds!.y + bounds!.height - arrow!.y - arrow!.height).toBeGreaterThanOrEqual(8);
      const textEnd = await speed.evaluate((node: HTMLSelectElement) => {
        const style = getComputedStyle(node);
        const canvas = document.createElement("canvas");
        const context = canvas.getContext("2d")!; context.font = style.font;
        return node.getBoundingClientRect().left + parseFloat(style.paddingLeft) + context.measureText(node.selectedOptions[0].text).width;
      });
      expect(arrow!.x - textEnd).toBeGreaterThanOrEqual(6);
    }
    const arrow = await icon.boundingBox();
    const hitTarget = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.id, { x: arrow!.x + arrow!.width / 2, y: arrow!.y + arrow!.height / 2 });
    expect(hitTarget).toBe("replay-speed");
    await speed.selectOption("1"); await speed.focus();
    await expect(speed).toBeFocused();
    await expect(speed).toHaveAccessibleName("Playback speed");
    await expect(speed).toHaveValue("1");
    await page.locator(".replay-transport").screenshot({ path: info.outputPath(`speed-${width}.png`) });
  }
});

test("activity highlight leaves room for dots and the keyboard focus outline", async ({ page }, info) => {
  const { ids } = await fixtures(page);
  for (const width of [375, 560, 800, 1440]) {
    await page.setViewportSize({ width, height: 752 });
    await page.goto(`/matches/${ids.tic}`);
    const card = page.locator(".event-item").last();
    const button = card.locator(".event-select");
    await card.scrollIntoViewIfNeeded(); await button.hover(); await button.focus();
    const bounds = await card.boundingBox();
    const dot = await card.locator(".event-marker").boundingBox();
    const target = await button.boundingBox();
    expect(dot!.x - bounds!.x).toBeGreaterThanOrEqual(8);
    expect(target!.x - bounds!.x).toBeGreaterThanOrEqual(8);
    expect(bounds!.x + bounds!.width - target!.x - target!.width).toBeGreaterThanOrEqual(8);
    expect(target!.y - bounds!.y).toBeGreaterThanOrEqual(8);
    await expect(button).toBeFocused();
    await card.screenshot({ path: info.outputPath(`activity-${width}.png`) });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
  }
});
