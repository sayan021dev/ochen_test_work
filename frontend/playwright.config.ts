import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: "http://127.0.0.1:5178",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        channel: process.env.CI ? undefined : "chrome",
        viewport: { width: 1440, height: 1000 },
      },
    },
  ],
  webServer: [
    {
      command:
        "../.venv/bin/uvicorn app.main:app --app-dir ../backend --host 127.0.0.1 --port 8017",
      url: "http://127.0.0.1:8017/api/ready",
      reuseExistingServer: !process.env.CI,
    },
    {
      command: "npm run dev",
      url: "http://127.0.0.1:5178",
      reuseExistingServer: !process.env.CI,
    },
    {
      command:
        "../.venv/bin/uvicorn app.main:app --app-dir ../backend --host 127.0.0.1 --port 8019",
      url: "http://127.0.0.1:8019/api/ready",
      reuseExistingServer: !process.env.CI,
      env: {
        SITE_PASSWORD: "test-access-only",
        REQUIRE_SITE_PASSWORD: "true",
        AUTH_SECRET: "test-signing-secret-for-browser-regressions-only",
        OPENAI_API_KEY: "",
        HTTP_PROXY: "",
        ALLOWED_ORIGINS: '["http://127.0.0.1:8019"]',
      },
    },
  ],
});
