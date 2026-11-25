import { expect, test } from "@playwright/test";

import { origins, ports } from "../src/env.ts";

for (const [name, origin] of Object.entries(origins)) {
  test(`the web ${name} opens and reaches its own server through the proxy`, async ({ page }) => {
    await page.goto(`${origin}/sign-in`);
    await expect(page.getByRole("button", { name: "Login" })).toBeVisible();

    const response = await page.request.get(`${origin}/api/auth/get-session`);
    expect(response.ok()).toBe(true);
  });
}

test("both server instances are up", async ({ request }) => {
  for (const port of [ports.serverA, ports.serverB]) {
    const response = await request.get(`http://localhost:${port}/health`);
    expect(await response.json()).toEqual({ status: "ok" });
  }
});
