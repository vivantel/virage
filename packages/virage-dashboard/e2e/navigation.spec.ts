import { test, expect } from "@playwright/test";
import type { Route } from "@playwright/test";

const DATA_APIS: Record<string, unknown> = {
  "/api/status": { totalChunks: 42, totalEmbeddings: 38, memoryMB: 128 },
  "/api/chunks": { histogram: [{ label: "0-100", count: 10 }] },
  "/api/embeddings/anomalies": { anomalies: [] },
  "/api/projects": {
    projects: [{ label: "my-project", rootPath: "/home/user/proj", embeddingsDb: "db", lastUsed: Date.now() }],
    activeIndex: 0,
  },
  "/api/meta-check": { status: "ok" },
  "/api/chunks/all": { chunks: [] },
  "/api/search": { results: [] },
  "/api/experiments": { runs: [] },
  "/api/analytics/stats": { queriesLastHour: 0, queriesLast24h: 0, avgTopSimilarity: 0, zeroResultRate: 0 },
  "/api/analytics/queries-per-hour": { buckets: [] },
  "/api/analytics/top-terms": { terms: [] },
  "/api/analytics/zero-results": { queries: [] },
};

async function mockDataApis(page: { route: (pattern: string, handler: (route: Route) => void) => Promise<void> }) {
  for (const [path, body] of Object.entries(DATA_APIS)) {
    await page.route(`**${path}**`, (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) }),
    );
  }
  // Do NOT block WebSocket — let it fail silently so PipelinePage/ExperimentsPage render
}

test.describe("Navigation", () => {
  test.beforeEach(async ({ page }) => {
    await mockDataApis(page);
  });

  test("shows Virage logo and Home link on load", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".sidebar-logo")).toContainText("Virage");
    await expect(page.locator(".sidebar a.active")).toContainText("Home");
  });

  test("navigates to Chunks page", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: "Chunks" }).click();
    await expect(page).toHaveURL(/\/chunks/);
    await expect(page.getByRole("heading", { name: "Chunk Browser" })).toBeVisible();
  });

  test("navigates to Search page", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: "Search" }).click();
    await expect(page).toHaveURL(/\/search/);
    await expect(page.getByRole("heading", { name: "RAG Search" })).toBeVisible();
  });

  test("navigates to Pipeline page", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: "Pipeline" }).click();
    await expect(page).toHaveURL(/\/pipeline/);
    await expect(page.getByRole("heading", { name: "Pipeline" })).toBeVisible();
  });

  test("navigates to Experiments page", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: "Experiments" }).click();
    await expect(page).toHaveURL(/\/experiments/);
    await expect(page.getByRole("heading", { name: "Experiments" })).toBeVisible();
  });

  test("navigates to Analytics page", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: "Analytics" }).click();
    await expect(page).toHaveURL(/\/analytics/);
    await expect(page.getByText("Search Activity")).toBeVisible({ timeout: 5000 });
  });
});
