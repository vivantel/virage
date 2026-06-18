import { test, expect } from "@playwright/test";

test.describe("Pipeline page", () => {
  test("renders Pipeline heading and Run button", async ({ page }) => {
    await page.goto("/pipeline");
    await expect(page.getByRole("heading", { name: "Pipeline" })).toBeVisible();
    await expect(page.getByRole("button", { name: /run/i })).toBeVisible();
  });

  test("shows placeholder text in log when idle", async ({ page }) => {
    await page.goto("/pipeline");
    await expect(page.getByText(/Select an operation/i)).toBeVisible();
  });

  test("Run button is initially enabled", async ({ page }) => {
    await page.goto("/pipeline");
    await expect(page.getByRole("button", { name: /run/i })).not.toBeDisabled();
  });

  test("pipeline operation dropdown shows Update index option", async ({ page }) => {
    await page.goto("/pipeline");
    // PrimeReact Dropdown renders the selected label in .p-dropdown-label span
    const dropdownLabel = page.locator(".p-dropdown-label");
    await expect(dropdownLabel).toBeVisible({ timeout: 5000 });
    await expect(dropdownLabel).toContainText(/Update index/i);
  });
});
