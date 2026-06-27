import { test, expect, type Page, type Route } from "@playwright/test";

async function stubExperiments(page: Page, runs: object[] = []) {
  await page.route("**/api/experiments", (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ runs }),
    }),
  );
}

test.describe("Experiments log filtering", () => {
  test.beforeEach(async ({ page }) => {
    await page.route("**/ws", (route: Route) => route.abort());
  });

  test("Run Log section is hidden when no operation is active", async ({
    page,
  }) => {
    await stubExperiments(page, []);
    await page.goto("/experiments");
    // Initially no eval op is running — Run Log heading must not be visible
    await expect(page.getByText("Run Log")).not.toBeVisible({ timeout: 3000 });
    // The Run button and name input are still present
    await expect(page.getByRole("button", { name: /run/i })).toBeVisible({
      timeout: 5000,
    });
  });

  test("pipeline page shows placeholder when idle, not on experiments page", async ({
    page,
  }) => {
    // Pipeline page: placeholder is visible because alwaysShow=true
    await page.goto("/pipeline");
    await expect(page.getByText(/Select an operation/i)).toBeVisible({
      timeout: 5000,
    });

    // Experiments page: no placeholder / Run Log when idle
    await stubExperiments(page, []);
    await page.goto("/experiments");
    await expect(page.getByText(/Select an operation/i)).not.toBeVisible();
    await expect(page.getByText("Run Log")).not.toBeVisible();
  });

  test("no experiment runs shows empty state", async ({ page }) => {
    await stubExperiments(page, []);
    await page.goto("/experiments");
    await expect(page.getByText(/No experiments found/i)).toBeVisible({
      timeout: 5000,
    });
  });

  test("experiment runs are listed in a table", async ({ page }) => {
    await stubExperiments(page, [
      {
        id: "exp-1",
        name: "baseline",
        timestamp: "2026-06-01T10:00:00Z",
        evalResult: {
          mrr: 0.65,
          precisionAt5: 0.72,
          recallAt10: 0.81,
          hitRateAt5: 0.88,
          queriesEvaluated: 100,
        },
      },
    ]);
    await page.goto("/experiments");
    await expect(page.getByText("baseline")).toBeVisible({ timeout: 5000 });
    await expect(page.getByText("65.0%")).toBeVisible();
  });
});
