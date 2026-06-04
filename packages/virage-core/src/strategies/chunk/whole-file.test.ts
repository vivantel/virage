import { describe, it, expect } from "vitest";
import { wholeFileStrategy } from "./whole-file.js";

describe("wholeFileStrategy", () => {
  describe("name", () => {
    it("is always 'whole-file'", () => {
      expect(wholeFileStrategy().name).toBe("whole-file");
    });
  });

  describe("empty / whitespace input", () => {
    it("returns empty array for empty string", async () => {
      expect(await wholeFileStrategy().chunk("")).toEqual([]);
    });

    it("returns empty array for whitespace-only string", async () => {
      expect(await wholeFileStrategy().chunk("   \n\t  ")).toEqual([]);
    });
  });

  describe("single-chunk output", () => {
    it("always returns exactly one chunk for non-empty text", async () => {
      const chunks = await wholeFileStrategy().chunk("Hello world.");
      expect(chunks).toHaveLength(1);
    });

    it("preserves full content including whitespace and newlines", async () => {
      const text = "line one\nline two\n  indented\n";
      const [chunk] = await wholeFileStrategy().chunk(text, "file.txt");
      expect(chunk.content).toBe(text);
    });

    it("preserves CRLF line endings unchanged", async () => {
      const text = "line one\r\nline two\r\nline three\r\n";
      const [chunk] = await wholeFileStrategy().chunk(text, "win.txt");
      expect(chunk.content).toBe(text);
    });
  });

  describe("chunk metadata", () => {
    it("populates all required metadata fields", async () => {
      const text = "Hello\nworld\n";
      const [chunk] = await wholeFileStrategy().chunk(text, "src/foo.yaml");

      expect(chunk.metadata.strategy).toBe("whole-file");
      expect(chunk.metadata.source_file).toBe("src/foo.yaml");
      expect(chunk.metadata.char_count).toBe(text.length);
      expect(chunk.metadata.line_count).toBe(3); // split("\n") gives 3 elements
      expect(chunk.sourceFile).toBe("src/foo.yaml");
      expect(chunk.commitHash).toBe("");
    });

    it("sourceFile falls back to 'unknown' when not provided", async () => {
      const [chunk] = await wholeFileStrategy().chunk("content");
      expect(chunk.sourceFile).toBe("unknown");
      expect(chunk.metadata.source_file).toBeUndefined();
    });

    it("char_count matches actual content length", async () => {
      const text = "abc\ndef\nghi";
      const [chunk] = await wholeFileStrategy().chunk(text);
      expect(chunk.metadata.char_count).toBe(text.length);
    });

    it("line_count matches newline count + 1", async () => {
      const text = "a\nb\nc";
      const [chunk] = await wholeFileStrategy().chunk(text);
      expect(chunk.metadata.line_count).toBe(3);
    });
  });

  describe("extractMetadata", () => {
    it("returns strategy, char_count and line_count", () => {
      const s = wholeFileStrategy();
      const text = "Hello\nworld";
      const meta = s.extractMetadata!(text, "f.txt");

      expect(meta.strategy).toBe("whole-file");
      expect(meta.char_count).toBe(text.length);
      expect(meta.line_count).toBe(2);
    });
  });

  describe("getQualityMetrics", () => {
    it("returns valid metric shape for a single chunk", async () => {
      const s = wholeFileStrategy();
      const chunks = await s.chunk("Hello world. Foo bar baz.");
      const metrics = s.getQualityMetrics!(chunks);

      expect(typeof metrics.avgChunkSize).toBe("number");
      expect(metrics.avgChunkSize).toBeGreaterThan(0);
      expect(metrics.stdDevChunkSize).toBe(0); // only one chunk → no deviation
      expect(metrics.semanticCoherence).toBeGreaterThanOrEqual(0);
      expect(metrics.semanticCoherence).toBeLessThanOrEqual(1);
      expect(metrics.informationDensity).toBeGreaterThanOrEqual(0);
      expect(metrics.informationDensity).toBeLessThanOrEqual(1);
    });
  });
});
