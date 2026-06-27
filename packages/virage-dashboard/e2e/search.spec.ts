import { test, expect } from "@playwright/test";
import type { Route } from "@playwright/test";

test.describe("Search page", () => {
  test.beforeEach(async ({ page }) => {
    await page.route("**/ws", (route: Route) => route.abort());
  });

  test("renders search input and button", async ({ page }) => {
    await page.goto("/search");
    await expect(page.getByPlaceholder(/search query/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /search/i })).toBeVisible();
  });

  test("search button is disabled when input is empty", async ({ page }) => {
    await page.goto("/search");
    await expect(page.getByRole("button", { name: /search/i })).toBeDisabled();
  });

  test("displays search results after query", async ({ page }) => {
    await page.route("**/api/search", (route: Route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          results: [
            {
              id: "r1",
              denseText: "Auth uses JWT tokens for session management.",
              sparseText: "auth jwt tokens session",
              metadata: {},
              similarity: 0.92,
              sourceFile: "src/auth.ts",
            },
            {
              id: "r2",
              denseText: "Token expiry is set to 24 hours.",
              sparseText: "token expiry hours",
              metadata: {},
              similarity: 0.78,
              sourceFile: "src/config.ts",
            },
          ],
        }),
      }),
    );
    await page.goto("/search");
    await page.getByPlaceholder(/search query/i).fill("how does auth work");
    await page.getByRole("button", { name: /search/i }).click();
    await expect(page.getByText("Auth uses JWT tokens")).toBeVisible({
      timeout: 5000,
    });
    await expect(page.getByText("92.0% match")).toBeVisible();
    await expect(page.getByText("src/auth.ts")).toBeVisible();
  });

  test("shows empty results message when no results", async ({ page }) => {
    await page.route("**/api/search", (route: Route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ results: [] }),
      }),
    );
    await page.goto("/search");
    await page.getByPlaceholder(/search query/i).fill("xyzzy");
    await page.getByRole("button", { name: /search/i }).click();
    await expect(page.getByText(/no results found/i)).toBeVisible({
      timeout: 5000,
    });
  });

  test("shows error when search fails", async ({ page }) => {
    await page.route("**/api/search", (route: Route) =>
      route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: "Internal server error" }),
      }),
    );
    await page.goto("/search");
    await page.getByPlaceholder(/search query/i).fill("test query");
    await page.getByRole("button", { name: /search/i }).click();
    await expect(page.getByText(/internal server error/i)).toBeVisible({
      timeout: 5000,
    });
  });

  test("shows result count after search", async ({ page }) => {
    await page.route("**/api/search", (route: Route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          results: [
            {
              id: "r1",
              denseText: "First.",
              sparseText: "first",
              metadata: {},
              similarity: 0.9,
              sourceFile: "a.ts",
            },
            {
              id: "r2",
              denseText: "Second.",
              sparseText: "second",
              metadata: {},
              similarity: 0.8,
              sourceFile: "b.ts",
            },
          ],
        }),
      }),
    );
    await page.goto("/search");
    await page.getByPlaceholder(/search query/i).fill("query");
    await page.getByRole("button", { name: /search/i }).click();
    await expect(page.getByText(/2 results/i)).toBeVisible({ timeout: 5000 });
  });

  test("expands result card to reveal extended chunk fields", async ({
    page,
  }) => {
    await page.route("**/api/search", (route: Route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          results: [
            {
              id: "chunk-42",
              denseText: "OAuth2 flow uses authorization codes.",
              sparseText: "oauth2 authorization code flow",
              metadata: { language: "typescript", framework: "express" },
              similarity: 0.88,
              sourceFile: "src/oauth.ts",
              sparseTextGeneratorId: "bm25-v3",
              metadataGeneratorId: "extractor-v2",
            },
          ],
        }),
      }),
    );
    await page.goto("/search");
    await page.getByPlaceholder(/search query/i).fill("oauth");
    await page.getByRole("button", { name: /search/i }).click();
    await expect(page.getByText("OAuth2 flow uses authorization codes.")).toBeVisible(
      { timeout: 5000 },
    );

    // Expand the card
    await page.getByRole("button", { name: /expand/i }).click();

    // Extended fields appear
    await expect(
      page.getByText("oauth2 authorization code flow"),
    ).toBeVisible();
    await expect(page.getByText("language")).toBeVisible();
    await expect(page.getByText("typescript")).toBeVisible();
    await expect(page.getByText("bm25-v3")).toBeVisible();
    await expect(page.getByText("extractor-v2")).toBeVisible();
    await expect(page.getByText("chunk-42")).toBeVisible();
  });

  test("shows sort control and result count when results are present", async ({
    page,
  }) => {
    await page.route("**/api/search", (route: Route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          results: [
            {
              id: "r1",
              denseText: "Some chunk text.",
              sparseText: "",
              metadata: {},
              similarity: 0.85,
              sourceFile: "a.ts",
            },
          ],
        }),
      }),
    );
    await page.goto("/search");
    await page.getByPlaceholder(/search query/i).fill("test");
    await page.getByRole("button", { name: /search/i }).click();
    await expect(page.getByText(/Sort by/i)).toBeVisible({ timeout: 5000 });
    await expect(page.getByText(/1 result/i)).toBeVisible();
  });
});
