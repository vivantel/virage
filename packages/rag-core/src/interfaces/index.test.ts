import { describe, it, expect } from "vitest";

describe("Interfaces", () => {
  it("should export types correctly", async () => {
    const module = await import("./index.js");

    expect(module).toBeDefined();
  });
});
