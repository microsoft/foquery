import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "src",
  testMatch: "**/*.e2e.ts",
  use: {
    baseURL: "http://127.0.0.1:5173",
  },
  webServer: [
    {
      command: "node scripts/dev-cross-origin.mjs",
      cwd: "../example",
      url: "http://127.0.0.1:5173",
      stdout: "pipe",
    },
    {
      command: "npx vite --host 127.0.0.1 --port 5198 --strictPort",
      url: "http://127.0.0.1:5198/panel.html",
      stdout: "pipe",
    },
  ],
});
