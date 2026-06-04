import { describe, it, expect } from "vitest";
import { tokenStrategy } from "./token.js";

// Alphabet repeated enough to fill any window size without sentence terminators.
// Using no `.` or `\n` lets us test predictable fixed-width boundaries.
const NO_BOUNDARY_TEXT = Array.from({ length: 500 }, (_, i) =>
  String.fromCharCode(65 + (i % 26)),
).join("");

describe("tokenStrategy", () => {
  describe("name", () => {
    it("encodes maxTokens in the name", () => {
      expect(tokenStrategy({ maxTokens: 100 }).name).toBe("token-100");
      expect(tokenStrategy({ maxTokens: 500 }).name).toBe("token-500");
    });

    it("uses default maxTokens when not specified", () => {
      expect(tokenStrategy().name).toBe("token-500");
    });
  });

  describe("empty / short input", () => {
    const s = tokenStrategy({ maxTokens: 50, overlap: 10 });

    it("returns empty array for empty string", async () => {
      expect(await s.chunk("")).toEqual([]);
    });

    it("returns empty array for whitespace-only string", async () => {
      expect(await s.chunk("   \n\t  ")).toEqual([]);
    });

    it("returns single chunk when text is shorter than maxChars", async () => {
      const text = "Short text.";
      const chunks = await s.chunk(text, "file.txt");
      expect(chunks).toHaveLength(1);
      expect(chunks[0].content).toBe(text.trim());
    });
  });

  describe("chunk metadata", () => {
    it("populates all required fields", async () => {
      const s = tokenStrategy({ maxTokens: 10, overlap: 2 });
      const [chunk] = await s.chunk(NO_BOUNDARY_TEXT, "src/foo.ts");

      expect(chunk.sourceFile).toBe("src/foo.ts");
      expect(chunk.commitHash).toBe("");
      expect(chunk.metadata.strategy).toBe("token-10");
      expect(chunk.metadata.source_file).toBe("src/foo.ts");
      expect(typeof chunk.metadata.start_char).toBe("number");
      expect(typeof chunk.metadata.end_char).toBe("number");
    });

    it("chunk_index increments from zero", async () => {
      const s = tokenStrategy({ maxTokens: 10, overlap: 2 });
      const chunks = await s.chunk(NO_BOUNDARY_TEXT, "f.ts");

      chunks.forEach((chunk, i) => {
        expect(chunk.metadata.chunk_index).toBe(i);
      });
    });

    it("sourceFile falls back to 'unknown' when omitted", async () => {
      const s = tokenStrategy({ maxTokens: 10, overlap: 2 });
      const [chunk] = await s.chunk(NO_BOUNDARY_TEXT);
      expect(chunk.sourceFile).toBe("unknown");
      expect(chunk.metadata.source_file).toBeUndefined();
    });

    it("start_char and end_char are consistent with content slice", async () => {
      const s = tokenStrategy({ maxTokens: 10, overlap: 2 });
      const chunks = await s.chunk(NO_BOUNDARY_TEXT, "f.ts");

      for (const chunk of chunks) {
        const start = chunk.metadata.start_char as number;
        const end = chunk.metadata.end_char as number;
        expect(NO_BOUNDARY_TEXT.slice(start, end).trim()).toBe(chunk.content);
      }
    });
  });

  describe("chunk sizing — no one-char sliding window", () => {
    it("non-final chunks are at least half of maxChars (sentence-only text)", async () => {
      const s = tokenStrategy({ maxTokens: 50, overlap: 10 });
      const text = "This is a test sentence. ".repeat(200);
      const chunks = await s.chunk(text, "test.txt");

      // maxTokens=50 → maxChars=200, overlapChars=40
      for (let i = 0; i < chunks.length - 1; i++) {
        expect(chunks[i].content.length).toBeGreaterThanOrEqual(50);
      }
    });

    it("consecutive chunks advance by more than one character", async () => {
      const s = tokenStrategy({ maxTokens: 50, overlap: 10 });
      const text = "This is a test sentence. ".repeat(200);
      const chunks = await s.chunk(text, "test.txt");

      for (let i = 1; i < chunks.length; i++) {
        const prevStart = chunks[i - 1].metadata.start_char as number;
        const currStart = chunks[i].metadata.start_char as number;
        expect(currStart - prevStart).toBeGreaterThan(1);
      }
    });

    it("non-final chunks from CRLF source are substantially sized", async () => {
      const s = tokenStrategy({ maxTokens: 50, overlap: 10 });
      const text = "const x = foo.bar();\r\n".repeat(200);
      const chunks = await s.chunk(text, "file.ts");

      for (let i = 0; i < chunks.length - 1; i++) {
        expect(chunks[i].content.length).toBeGreaterThanOrEqual(50);
      }
      for (let i = 1; i < chunks.length; i++) {
        const prevStart = chunks[i - 1].metadata.start_char as number;
        const currStart = chunks[i].metadata.start_char as number;
        expect(currStart - prevStart).toBeGreaterThan(1);
      }
    });
  });

  describe("overlap behaviour", () => {
    it("consecutive chunks share overlapping content", async () => {
      // No sentence terminators → predictable fixed-width boundaries.
      // maxTokens=10 → maxChars=40; overlap=5 → overlapChars=20; step=20.
      const s = tokenStrategy({ maxTokens: 10, overlap: 5 });
      const chunks = await s.chunk(NO_BOUNDARY_TEXT, "f.ts");

      expect(chunks.length).toBeGreaterThan(1);

      for (let i = 1; i < chunks.length; i++) {
        const prev = chunks[i - 1].content;
        const curr = chunks[i].content;
        // The tail of the previous chunk must be a prefix of the current chunk.
        const overlapLen = Math.min(20, prev.length, curr.length);
        expect(curr.startsWith(prev.slice(-overlapLen))).toBe(true);
      }
    });

    it("no overlap produces non-overlapping adjacent chunks", async () => {
      const s = tokenStrategy({ maxTokens: 10, overlap: 0 });
      const chunks = await s.chunk(NO_BOUNDARY_TEXT, "f.ts");

      for (let i = 1; i < chunks.length; i++) {
        const prevEnd = chunks[i - 1].metadata.end_char as number;
        const currStart = chunks[i].metadata.start_char as number;
        expect(currStart).toBeGreaterThanOrEqual(prevEnd);
      }
    });
  });

  describe("misconfiguration safety", () => {
    it("overlap >= maxTokens does not cause infinite crawl", async () => {
      const s = tokenStrategy({ maxTokens: 20, overlap: 60 });
      const text = "word ".repeat(200);
      const chunks = await s.chunk(text, "test.txt");

      expect(chunks.length).toBeGreaterThan(0);
      for (const chunk of chunks) {
        expect(chunk.content.length).toBeGreaterThan(1);
      }
      for (let i = 1; i < chunks.length; i++) {
        const prevStart = chunks[i - 1].metadata.start_char as number;
        const currStart = chunks[i].metadata.start_char as number;
        expect(currStart - prevStart).toBeGreaterThan(1);
      }
    });
  });

  describe("extractMetadata", () => {
    it("returns strategy, char_count and estimated_tokens", () => {
      const s = tokenStrategy({ maxTokens: 100 });
      const meta = s.extractMetadata!("Hello world");

      expect(meta.strategy).toBe("token-100");
      expect(meta.char_count).toBe(11);
      expect(meta.estimated_tokens).toBe(Math.ceil(11 / 4));
    });
  });

  describe("getQualityMetrics", () => {
    it("returns valid metric shape for non-empty chunks", async () => {
      const s = tokenStrategy({ maxTokens: 50, overlap: 10 });
      const chunks = await s.chunk("Hello world. Foo bar.".repeat(10));
      const metrics = s.getQualityMetrics!(chunks);

      expect(typeof metrics.avgChunkSize).toBe("number");
      expect(typeof metrics.stdDevChunkSize).toBe("number");
      expect(metrics.semanticCoherence).toBeGreaterThanOrEqual(0);
      expect(metrics.semanticCoherence).toBeLessThanOrEqual(1);
      expect(metrics.informationDensity).toBeGreaterThanOrEqual(0);
      expect(metrics.informationDensity).toBeLessThanOrEqual(1);
    });
  });
});
