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
            { id: "r1", content: "Auth uses JWT tokens for session management.", metadata: {}, similarity: 0.92, sourceFile: "src/auth.ts" },
            { id: "r2", content: "Token expiry is set to 24 hours.", metadata: {}, similarity: 0.78, sourceFile: "src/config.ts" },
            { id: "r3", content: "Refresh tokens are rotated on use.", metadata: {}, similarity: 0.71, sourceFile: "src/tokens.ts" },
          ],
        }),
      }),
    );
    await page.goto("/search");
    await page.getByPlaceholder(/search query/i).fill("how does auth work");
    await page.getByRole("button", { name: /search/i }).click();
    await expect(page.getByText("Auth uses JWT tokens")).toBeVisible({ timeout: 5000 });
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
    await expect(page.getByText(/no results found/i)).toBeVisible({ timeout: 5000 });
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
    await expect(page.getByText(/internal server error/i)).toBeVisible({ timeout: 5000 });
  });
});
