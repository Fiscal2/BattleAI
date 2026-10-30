import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/e2e",
  forbidOnly: !!process.env.CI,
  workers: 1,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: { baseURL: "http://127.0.0.1:3108", headless: true, viewport: { width: 1440, height: 1000 }, trace: process.env.CI ? "retain-on-failure" : "off", screenshot: "only-on-failure" },
  webServer: { command: "npm run test:e2e:serve", url: "http://127.0.0.1:3108/login", reuseExistingServer: false, timeout: 30_000 },
});
