import { describe, it, expect } from "vitest";
import { markdownHeadersStrategy } from "./markdown-headers.js";

describe("markdownHeadersStrategy", () => {
  const strategy = markdownHeadersStrategy({ minChunkSize: 10 });

  it("should have correct name", () => {
    expect(strategy.name).toBe("markdown-headers");
  });

  it("should split by headers", async () => {
    const text = `# Header 1
Content for header 1.

## Header 2
Content for header 2.

### Header 3
Content for header 3.`;

    const chunks = await strategy.chunk(text);

    expect(chunks.length).toBeGreaterThan(0);

    for (const chunk of chunks) {
      expect(chunk.metadata.header).toBeDefined();
      expect(chunk.metadata.header_level).toBeDefined();
    }
  });

  it("should handle text without headers", async () => {
    const text = "Plain text without any markdown headers.";
    const chunks = await strategy.chunk(text);

    expect(Array.isArray(chunks)).toBe(true);
  });
});
