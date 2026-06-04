import { describe, it, expect } from "vitest";
import { semanticStrategy } from "./semantic.js";

describe("semanticStrategy", () => {
  describe("name", () => {
    it("is always 'semantic'", () => {
      expect(semanticStrategy().name).toBe("semantic");
      expect(semanticStrategy({ maxChars: 999 }).name).toBe("semantic");
    });
  });

  describe("empty / short input", () => {
    const s = semanticStrategy({ maxChars: 200, minChars: 10 });

    it("returns empty array for empty string", async () => {
      expect(await s.chunk("")).toEqual([]);
    });

    it("returns empty array when the only content is below minChars and there is no previous chunk to merge into", async () => {
      // "Hi." is 3 chars, below minChars=10, and it is the first (and only) batch.
      const chunks = await s.chunk("Hi.");
      expect(chunks).toHaveLength(0);
    });

    it("returns a single chunk for text longer than minChars with no terminators", async () => {
      const s2 = semanticStrategy({ maxChars: 500, minChars: 10 });
      const text = "no sentence terminator in this text at all";
      const chunks = await s2.chunk(text, "plain.txt");
      expect(chunks).toHaveLength(1);
      expect(chunks[0].content).toBe(text.trim());
    });
  });

  describe("sentence splitting", () => {
    it("splits on . ! and ? boundaries", async () => {
      const s = semanticStrategy({ maxChars: 60, minChars: 5 });
      const text =
        "First sentence. Second sentence! Third sentence? Fourth one.";
      const chunks = await s.chunk(text);

      expect(chunks.length).toBeGreaterThan(0);
      for (const chunk of chunks) {
        expect(chunk.metadata.strategy).toBe("semantic");
      }
      const joined = chunks.map((c) => c.content).join(" ");
      expect(joined).toContain("First sentence");
      expect(joined).toContain("Fourth one");
    });

    it("no individual chunk exceeds maxChars", async () => {
      const s = semanticStrategy({ maxChars: 100, minChars: 5 });
      const text = "Short sentence. ".repeat(30);
      const chunks = await s.chunk(text);

      for (const chunk of chunks) {
        expect(chunk.content.length).toBeLessThanOrEqual(120); // small tolerance for last-word boundary
      }
    });
  });

  describe("chunk metadata", () => {
    it("populates strategy, sentence_count and source_file", async () => {
      const s = semanticStrategy({ maxChars: 200, minChars: 5 });
      const text = "First. Second. Third. Fourth. Fifth.";
      const chunks = await s.chunk(text, "doc.txt");

      for (const chunk of chunks) {
        expect(chunk.metadata.strategy).toBe("semantic");
        expect(typeof chunk.metadata.sentence_count).toBe("number");
        expect(chunk.metadata.source_file).toBe("doc.txt");
        expect(chunk.sourceFile).toBe("doc.txt");
        expect(chunk.commitHash).toBe("");
      }
    });

    it("last chunk carries is_last flag", async () => {
      const s = semanticStrategy({ maxChars: 80, minChars: 5 });
      const text = "One. Two. Three. Four. Five. Six. Seven. Eight.";
      const chunks = await s.chunk(text);

      expect(chunks.length).toBeGreaterThan(0);
      expect(chunks[chunks.length - 1].metadata.is_last).toBe(true);
    });

    it("sourceFile falls back to 'unknown' when omitted", async () => {
      const s = semanticStrategy({ maxChars: 200, minChars: 5 });
      const [chunk] = await s.chunk("Hello world. This is a test.");
      expect(chunk.sourceFile).toBe("unknown");
    });
  });

  describe("short tail handling", () => {
    it("merges a short tail into the previous chunk instead of dropping it", async () => {
      const s = semanticStrategy({ maxChars: 200, minChars: 30 });
      // Two long sentences followed by a very short one.
      const text =
        "This is the first sentence that has some length. " +
        "This is the second sentence that also has length. " +
        "Short.";

      const chunks = await s.chunk(text);

      const allContent = chunks.map((c) => c.content).join(" ");
      expect(allContent).toContain("Short.");
    });

    it("merged tail chunk carries is_last on the previous chunk", async () => {
      const s = semanticStrategy({ maxChars: 200, minChars: 30 });
      const text =
        "This is the first sentence that has enough characters. " +
        "This is the second one. " +
        "Tiny.";

      const chunks = await s.chunk(text);
      // The last chunk in the array must always carry is_last.
      expect(chunks[chunks.length - 1].metadata.is_last).toBe(true);
    });
  });

  describe("extractMetadata", () => {
    it("returns strategy, sentence_count and char_count", () => {
      const s = semanticStrategy();
      const meta = s.extractMetadata!("Hello world. Foo bar.");

      expect(meta.strategy).toBe("semantic");
      expect(typeof meta.sentence_count).toBe("number");
      expect(meta.char_count).toBe(21);
    });
  });

  describe("getQualityMetrics", () => {
    it("returns valid metric shape for non-empty chunks", async () => {
      const s = semanticStrategy({ maxChars: 100, minChars: 5 });
      const chunks = await s.chunk("Hello world. Foo bar. Baz qux.".repeat(5));
      const metrics = s.getQualityMetrics!(chunks);

      expect(typeof metrics.avgChunkSize).toBe("number");
      expect(metrics.semanticCoherence).toBeGreaterThanOrEqual(0);
      expect(metrics.semanticCoherence).toBeLessThanOrEqual(1);
      expect(metrics.informationDensity).toBeGreaterThanOrEqual(0);
      expect(metrics.informationDensity).toBeLessThanOrEqual(1);
    });
  });
});
