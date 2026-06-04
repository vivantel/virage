import { describe, it, expect } from "vitest";
import { markdownHeadersStrategy } from "./markdown-headers.js";

const FULL_DOC = `# Introduction
This is the introduction section with enough content to pass minChunkSize.

## Background
Background details go here. More text to make it substantial.

### Deep Dive
A deeper section with even more content to ensure chunking works.

## Conclusion
Final thoughts and wrapping up.`;

describe("markdownHeadersStrategy", () => {
  describe("name", () => {
    it("is always 'markdown-headers'", () => {
      expect(markdownHeadersStrategy().name).toBe("markdown-headers");
    });
  });

  describe("empty / header-less input", () => {
    const s = markdownHeadersStrategy({ minChunkSize: 10 });

    it("returns empty array for empty string", async () => {
      expect(await s.chunk("")).toEqual([]);
    });

    it("returns empty array when the only content is below minChunkSize", async () => {
      expect(await s.chunk("tiny")).toEqual([]);
    });

    it("returns single chunk for plain text without headers that meets minChunkSize", async () => {
      const text =
        "Plain text without any markdown headers. Enough content here.";
      const chunks = await s.chunk(text, "plain.txt");
      expect(chunks.length).toBeGreaterThan(0);
      for (const chunk of chunks) {
        expect(chunk.content).toBeTruthy();
      }
    });
  });

  describe("header splitting", () => {
    it("produces one chunk per header section", async () => {
      const s = markdownHeadersStrategy({ minChunkSize: 5 });
      const chunks = await s.chunk(FULL_DOC, "doc.md");

      // FULL_DOC has 4 headers; expect at least that many chunks.
      expect(chunks.length).toBeGreaterThanOrEqual(4);
    });

    it("each chunk carries header and header_level metadata", async () => {
      const s = markdownHeadersStrategy({ minChunkSize: 5 });
      const chunks = await s.chunk(FULL_DOC, "doc.md");

      for (const chunk of chunks) {
        expect(chunk.metadata.header).toBeDefined();
        expect(typeof chunk.metadata.header).toBe("string");
        expect(typeof chunk.metadata.header_level).toBe("number");
      }
    });

    it("parses header levels 1–6 correctly", async () => {
      const s = markdownHeadersStrategy({ minChunkSize: 1 });
      const text = [
        "# H1\ncontent1",
        "## H2\ncontent2",
        "### H3\ncontent3",
        "#### H4\ncontent4",
        "##### H5\ncontent5",
        "###### H6\ncontent6",
      ].join("\n");

      const chunks = await s.chunk(text, "levels.md");
      const levels = chunks.map((c) => c.metadata.header_level as number);

      expect(levels).toContain(1);
      expect(levels).toContain(2);
      expect(levels).toContain(3);
      expect(levels).toContain(4);
      expect(levels).toContain(5);
      expect(levels).toContain(6);
    });

    it("header text matches the heading line content", async () => {
      const s = markdownHeadersStrategy({ minChunkSize: 5 });
      const chunks = await s.chunk(FULL_DOC, "doc.md");

      const headers = chunks.map((c) => c.metadata.header as string);
      expect(headers).toContain("Introduction");
      expect(headers).toContain("Background");
      expect(headers).toContain("Conclusion");
    });

    it("content before the first header is collected under an empty header", async () => {
      const s = markdownHeadersStrategy({ minChunkSize: 5 });
      const text =
        "Preamble content before any heading.\n\n# Section One\nContent here.";
      const chunks = await s.chunk(text, "preamble.md");

      expect(chunks.length).toBeGreaterThanOrEqual(1);
      // Preamble chunk has no header (empty string or undefined)
      const preamble = chunks.find(
        (c) => !c.metadata.header || c.metadata.header === "",
      );
      expect(preamble).toBeDefined();
      expect(preamble!.content).toContain("Preamble");
    });

    it("sections below minChunkSize are skipped", async () => {
      const s = markdownHeadersStrategy({ minChunkSize: 500 });
      const text = "# Short\nTiny content.\n\n# Long\n" + "x".repeat(600);
      const chunks = await s.chunk(text);

      // Only the long section should be included.
      for (const chunk of chunks) {
        expect(chunk.content.length).toBeGreaterThanOrEqual(500);
      }
    });

    it("consecutive headers with no body between them do not produce empty chunks", async () => {
      const s = markdownHeadersStrategy({ minChunkSize: 5 });
      const text = "# First\n## Second\nContent for second section only.";
      const chunks = await s.chunk(text, "consec.md");

      for (const chunk of chunks) {
        expect(chunk.content.trim()).not.toBe("");
      }
    });
  });

  describe("chunk metadata", () => {
    it("all chunks carry strategy and source_file", async () => {
      const s = markdownHeadersStrategy({ minChunkSize: 5 });
      const chunks = await s.chunk(FULL_DOC, "doc.md");

      for (const chunk of chunks) {
        expect(chunk.metadata.strategy).toBe("markdown-headers");
        expect(chunk.metadata.source_file).toBe("doc.md");
        expect(chunk.sourceFile).toBe("doc.md");
        expect(chunk.commitHash).toBe("");
      }
    });

    it("last chunk carries is_last flag", async () => {
      const s = markdownHeadersStrategy({ minChunkSize: 5 });
      const chunks = await s.chunk(FULL_DOC, "doc.md");

      expect(chunks.length).toBeGreaterThan(0);
      expect(chunks[chunks.length - 1].metadata.is_last).toBe(true);
    });

    it("sourceFile falls back to 'unknown' when not provided", async () => {
      const s = markdownHeadersStrategy({ minChunkSize: 5 });
      const [chunk] = await s.chunk(FULL_DOC);
      expect(chunk.sourceFile).toBe("unknown");
    });
  });

  describe("CRLF normalisation", () => {
    it("header text contains no trailing \\r", async () => {
      const s = markdownHeadersStrategy({ minChunkSize: 5 });
      const text =
        "# Header One\r\nContent line.\r\n## Header Two\r\nMore content here.\r\n";
      const chunks = await s.chunk(text, "crlf.md");

      for (const chunk of chunks) {
        expect(chunk.metadata.header as string).not.toMatch(/\r/);
      }
    });

    it("chunk content contains no \\r characters", async () => {
      const s = markdownHeadersStrategy({ minChunkSize: 5 });
      const text =
        "# Header One\r\nContent line.\r\n## Header Two\r\nMore content here.\r\n";
      const chunks = await s.chunk(text, "crlf.md");

      for (const chunk of chunks) {
        expect(chunk.content).not.toMatch(/\r/);
      }
    });
  });

  describe("maxChunkSize truncation", () => {
    it("truncated chunks carry source_file", async () => {
      const s = markdownHeadersStrategy({ minChunkSize: 5, maxChunkSize: 200 });
      const body = "Some content line here that is moderate length.\n".repeat(
        20,
      );
      const text = `# Big Section\n${body}`;
      const chunks = await s.chunk(text, "big.md");

      const truncated = chunks.filter((c) => c.metadata.truncated);
      for (const chunk of truncated) {
        expect(chunk.metadata.source_file).toBe("big.md");
      }
    });

    it("continuation after truncation starts with the section header", async () => {
      const s = markdownHeadersStrategy({ minChunkSize: 5, maxChunkSize: 200 });
      const body = "Some content line here that is moderate length.\n".repeat(
        20,
      );
      const text = `# Big Section\n${body}`;
      const chunks = await s.chunk(text, "big.md");

      const truncated = chunks.filter((c) => c.metadata.truncated);
      if (truncated.length > 0) {
        // Find the chunk immediately after the first truncated one.
        const firstTruncIdx = chunks.indexOf(truncated[0]);
        const continuation = chunks[firstTruncIdx + 1];
        if (continuation) {
          // The continuation must belong to the same header section.
          expect(continuation.metadata.header).toBe("Big Section");
        }
      }
    });
  });

  describe("extractMetadata", () => {
    it("detects presence of headers and first header text", () => {
      const s = markdownHeadersStrategy();
      const meta = s.extractMetadata!(FULL_DOC, "doc.md");

      expect(meta.has_headers).toBe(true);
      expect(meta.first_header).toBe("Introduction");
      expect(typeof meta.line_count).toBe("number");
    });

    it("reports has_headers=false for plain text", () => {
      const s = markdownHeadersStrategy();
      const meta = s.extractMetadata!("No headers here.", "plain.txt");

      expect(meta.has_headers).toBe(false);
      expect(meta.first_header).toBeUndefined();
    });
  });

  describe("getQualityMetrics", () => {
    it("returns valid metric shape for non-empty chunks", async () => {
      const s = markdownHeadersStrategy({ minChunkSize: 5 });
      const chunks = await s.chunk(FULL_DOC, "doc.md");
      const metrics = s.getQualityMetrics!(chunks);

      expect(typeof metrics.avgChunkSize).toBe("number");
      expect(metrics.avgChunkSize).toBeGreaterThan(0);
      expect(metrics.semanticCoherence).toBeGreaterThanOrEqual(0);
      expect(metrics.semanticCoherence).toBeLessThanOrEqual(1);
      expect(metrics.informationDensity).toBeGreaterThanOrEqual(0);
      expect(metrics.informationDensity).toBeLessThanOrEqual(1);
    });
  });
});
