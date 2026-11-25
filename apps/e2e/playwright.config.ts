import { defineConfig, devices } from "@playwright/test";

import { authSecret, mongoUrl, origins, ports, redisUrl } from "./src/env.ts";

const isCi = Boolean(process.env.CI);

/** One server instance: `tsx` on the real entry point, with the env it needs and no .env file. */
const serverProcess = (port: number, webOrigin: string) => ({
  command: "pnpm --filter @collaborative-text-editor/server exec tsx src/server.ts",
  url: `http://localhost:${port}/health`,
  reuseExistingServer: false,
  timeout: 60_000,
  env: {
    NODE_ENV: "development",
    PORT: String(port),
    MONGO_URL: mongoUrl,
    BETTER_AUTH_SECRET: authSecret,
    BETTER_AUTH_URL: `http://localhost:${port}`,
    WEB_URL: webOrigin,
    REDIS_URL: redisUrl,
  },
});

/** One Vite dev server, proxying /api (and the sockets) to one server instance. */
const webProcess = (port: number, apiPort: number) => ({
  command: `pnpm --filter @collaborative-text-editor/web exec vite --port ${port} --strictPort`,
  url: `http://localhost:${port}`,
  reuseExistingServer: false,
  timeout: 60_000,
  env: { API_URL: `http://localhost:${apiPort}` },
});

export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  forbidOnly: isCi,
  retries: isCi ? 1 : 0,
  reporter: isCi ? [["github"], ["html", { open: "never" }]] : [["list"]],
  use: {
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "one-instance", use: { ...devices["Desktop Chrome"] } },
    { name: "two-instances", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: [
    serverProcess(ports.serverA, origins.a),
    serverProcess(ports.serverB, origins.b),
    webProcess(ports.webA, ports.serverA),
    webProcess(ports.webB, ports.serverB),
  ],
});
