import { describe, it, expect } from "vitest";
import { wholeFileStrategy } from "./whole-file.js";

describe("wholeFileStrategy", () => {
  const strategy = wholeFileStrategy();

  it("should have correct name", () => {
    expect(strategy.name).toBe("whole-file");
  });

  it("should return single chunk", async () => {
    const text = "Complete file content.";
    const chunks = await strategy.chunk(text);

    expect(chunks).toHaveLength(1);
    expect(chunks[0].content).toBe(text);
    expect(chunks[0].metadata.strategy).toBe("whole-file");
  });

  it("should return empty array for empty text", async () => {
    const chunks = await strategy.chunk("");
    expect(chunks).toHaveLength(0);
  });
});
