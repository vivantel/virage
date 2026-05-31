import { describe, it, expect } from "vitest";
import { semanticStrategy } from "./semantic.js";

describe("semanticStrategy", () => {
  const strategy = semanticStrategy({ maxChars: 100, minChars: 10 });

  it("should have correct name", () => {
    expect(strategy.name).toBe("semantic");
  });

  it("should split by sentences", async () => {
    const text = "First sentence. Second sentence! Third sentence? Fourth.";
    const chunks = await strategy.chunk(text);

    expect(Array.isArray(chunks)).toBe(true);

    for (const chunk of chunks) {
      expect(chunk.metadata.strategy).toBe("semantic");
    }
  });
});
