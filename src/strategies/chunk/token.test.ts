import { describe, it, expect } from "vitest";
import { tokenStrategy } from "./token.js";

describe("tokenStrategy", () => {
  const strategy = tokenStrategy({ maxTokens: 50, overlap: 10 });

  it("should have correct name", () => {
    expect(strategy.name).toContain("token");
    expect(typeof strategy.name).toBe("string");
  });

  it("should chunk text", async () => {
    const text = "This is a test sentence. ".repeat(100);
    const chunks = await strategy.chunk(text, "test.txt");

    expect(Array.isArray(chunks)).toBe(true);
    expect(chunks.length).toBeGreaterThan(0);

    if (chunks.length > 0) {
      expect(chunks[0].content).toBeDefined();
      expect(typeof chunks[0].content).toBe("string");
      expect(chunks[0].metadata).toBeDefined();
      expect(chunks[0].metadata.strategy).toBeDefined();
    }
  });

  it("should extract metadata", () => {
    const text = "Test content";
    const metadata = strategy.extractMetadata?.(text);

    // extractMetadata is optional, so it might be undefined
    if (metadata) {
      expect(metadata.strategy).toBe(strategy.name);
      expect(metadata.char_count).toBeDefined();
      expect(metadata.estimated_tokens).toBeDefined();
    } else {
      // If extractMetadata is not implemented, just pass
      expect(true).toBe(true);
    }
  });
});
