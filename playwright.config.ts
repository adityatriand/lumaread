import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  testMatch: "*.e2e.ts",
  use: { baseURL: "http://localhost:4173" },
  // Chrome stands in for Android's WebView, WebKit for the macOS app's: they differ (e.g. listeners in sandboxed frames)
  projects: [
    { name: "chrome", use: { channel: "chrome" } },
    { name: "webkit", use: { browserName: "webkit" } },
  ],
  webServer: {
    command: "pnpm build && pnpm preview --port 4173 --strictPort",
    url: "http://localhost:4173",
    reuseExistingServer: !process.env.CI,
  },
});
