import { test, expect, type Page, type Route } from "@playwright/test";

async function stubHomeRoutes(page: Page, chunksHistogram: { label: string; count: number }[]) {
  await page.route("**/api/status", (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ totalChunks: 0, totalEmbeddings: 0, memoryMB: 0 }),
    }),
  );
  await page.route("**/api/chunks", (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ histogram: chunksHistogram }),
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
          {
            label: "test-project",
            rootPath: "/home/user/test",
            embeddingsDb: "db",
            lastUsed: Date.now(),
          },
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
}

test.describe("Chunk Size Distribution histogram", () => {
  test("shows empty-state message when no chunks indexed", async ({ page }) => {
    await stubHomeRoutes(page, []);
    await page.goto("/");
    await expect(page.getByText(/no chunks indexed/i)).toBeVisible({
      timeout: 5000,
    });
    await expect(page.getByText("Chunk Size Distribution")).toBeVisible();
  });

  test("shows empty-state for all-zero bucket counts", async ({ page }) => {
    await stubHomeRoutes(page, [
      { label: "< 200 chars", count: 0 },
      { label: "200–500 chars", count: 0 },
    ]);
    await page.goto("/");
    await expect(page.getByText(/no chunks indexed/i)).toBeVisible({
      timeout: 5000,
    });
  });

  test("shows chart title without empty-state when buckets have data", async ({
    page,
  }) => {
    await stubHomeRoutes(page, [
      { label: "< 200 chars", count: 25 },
      { label: "200–500 chars", count: 80 },
    ]);
    await page.goto("/");
    await expect(page.getByText("Chunk Size Distribution")).toBeVisible({
      timeout: 5000,
    });
    await expect(page.getByText(/no chunks indexed/i)).not.toBeVisible();
  });
});
