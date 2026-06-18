import { test, expect } from "@playwright/test";
import type { Route } from "@playwright/test";

test.describe("Home page", () => {
  test.beforeEach(async ({ page }) => {
    await page.route("**/api/status", (route: Route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ totalChunks: 250, totalEmbeddings: 245, memoryMB: 64 }),
      }),
    );
    await page.route("**/api/chunks", (route: Route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          histogram: [
            { label: "0-100", count: 15 },
            { label: "100-200", count: 40 },
            { label: "200-500", count: 120 },
          ],
        }),
      }),
    );
    await page.route("**/api/embeddings/anomalies", (route: Route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ anomalies: [] }),
      }),
    );
    await page.route("**/api/projects", (route: Route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          projects: [
            { label: "virage-repo", rootPath: "/home/user/virage", embeddingsDb: "db", lastUsed: Date.now() },
          ],
          activeIndex: 0,
        }),
      }),
    );
    await page.route("**/api/meta-check", (route: Route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ status: "ok" }),
      }),
    );
    await page.route("**/ws", (route: Route) => route.abort());
  });

  test("displays system metric values", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("250")).toBeVisible({ timeout: 5000 });
    await expect(page.getByText("245")).toBeVisible();
    await expect(page.getByText("64 MB")).toBeVisible();
  });

  test("displays project name in switcher", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("virage-repo")).toBeVisible({ timeout: 5000 });
  });

  test("shows System Status heading", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("System Status")).toBeVisible({ timeout: 5000 });
  });

  test("shows Chunk Size Distribution when histogram data present", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("Chunk Size Distribution")).toBeVisible({ timeout: 5000 });
  });

  test("shows anomaly table when anomalies present", async ({ page }) => {
    await page.route("**/api/embeddings/anomalies", (route: Route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          anomalies: [
            { sourceFile: "src/bad.ts", zscore: 3.87, preview: "weird content here" },
          ],
        }),
      }),
    );
    await page.goto("/");
    await expect(page.getByText("Embedding Anomalies")).toBeVisible({ timeout: 5000 });
    await expect(page.getByText("src/bad.ts")).toBeVisible();
  });
});
