import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "src",
  testMatch: "**/*.e2e.ts",
  use: {
    baseURL: "http://localhost:5199",
  },
  webServer: [
    {
      command: "npx vite --port 5199",
      cwd: "../example",
      url: "http://localhost:5199",
      stdout: "pipe",
    },
    {
      command: "npx vite --port 5198 --strictPort",
      url: "http://localhost:5198/panel.html",
      stdout: "pipe",
    },
  ],
});
