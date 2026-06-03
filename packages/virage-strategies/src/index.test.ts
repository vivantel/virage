import { describe, it, expect } from "vitest";
import {
  tokenStrategy,
  markdownHeadersStrategy,
  semanticStrategy,
  wholeFileStrategy,
} from "./index.js";

// ──────────────────────────────────────────────────────────────
// Export smoke tests
// ──────────────────────────────────────────────────────────────

describe("package exports", () => {
  it("exports all four strategy factories", () => {
    expect(typeof tokenStrategy).toBe("function");
    expect(typeof markdownHeadersStrategy).toBe("function");
    expect(typeof semanticStrategy).toBe("function");
    expect(typeof wholeFileStrategy).toBe("function");
  });

  it("each factory returns an object with chunk(), extractMetadata(), and getQualityMetrics()", () => {
    for (const factory of [
      tokenStrategy,
      markdownHeadersStrategy,
      semanticStrategy,
      wholeFileStrategy,
    ]) {
      const s = factory();
      expect(typeof s.chunk).toBe("function");
      expect(typeof s.extractMetadata).toBe("function");
      expect(typeof s.getQualityMetrics).toBe("function");
    }
  });
});

// ──────────────────────────────────────────────────────────────
// wholeFileStrategy
// ──────────────────────────────────────────────────────────────

describe("wholeFileStrategy", () => {
  const strategy = wholeFileStrategy();

  it("returns a single chunk containing the full text", async () => {
    const text = "Hello world. This is a test file.";
    const chunks = await strategy.chunk(text, "test.txt");

    expect(chunks).toHaveLength(1);
    expect(chunks[0].content).toBe(text);
  });

  it("returns empty array for blank text", async () => {
    expect(await strategy.chunk("", "test.txt")).toHaveLength(0);
    expect(await strategy.chunk("   \n\t  ", "test.txt")).toHaveLength(0);
  });

  it("sets sourceFile and strategy name in metadata", async () => {
    const chunks = await strategy.chunk("content", "file.yaml");

    expect(chunks[0].sourceFile).toBe("file.yaml");
    expect(chunks[0].metadata.strategy).toBe("whole-file");
  });

  it("metadata includes char_count and line_count", async () => {
    const text = "line1\nline2\nline3";
    const chunks = await strategy.chunk(text);

    expect(chunks[0].metadata.char_count).toBe(text.length);
    expect(chunks[0].metadata.line_count).toBe(3);
  });

  it("strategy name is 'whole-file'", () => {
    expect(strategy.name).toBe("whole-file");
  });

  it("extractMetadata returns char_count and line_count", () => {
    const meta = strategy.extractMetadata!("a\nb\nc");
    expect(meta.char_count).toBe(5);
    expect(meta.line_count).toBe(3);
  });

  it("getQualityMetrics on a single chunk returns valid metrics", async () => {
    const chunks = await strategy.chunk(
      "The quick brown fox jumps over the lazy dog.",
      "f.txt",
    );
    const metrics = strategy.getQualityMetrics!(chunks);

    expect(metrics.avgChunkSize).toBeGreaterThan(0);
    expect(metrics.semanticCoherence).toBeGreaterThanOrEqual(0);
    expect(metrics.informationDensity).toBeGreaterThan(0);
  });
});

// ──────────────────────────────────────────────────────────────
// tokenStrategy
// ──────────────────────────────────────────────────────────────

describe("tokenStrategy", () => {
  it("uses name token-{maxTokens}", () => {
    expect(tokenStrategy().name).toBe("token-500");
    expect(tokenStrategy({ maxTokens: 100 }).name).toBe("token-100");
  });

  it("returns empty array for empty text", async () => {
    expect(await tokenStrategy().chunk("", "f.ts")).toHaveLength(0);
  });

  it("returns a single chunk when text is shorter than maxTokens", async () => {
    // overlap: 0 avoids the start+1 fallback that re-slices short text
    const strategy = tokenStrategy({ maxTokens: 500, overlap: 0 });
    const text = "Short content.";
    const chunks = await strategy.chunk(text, "f.ts");

    expect(chunks).toHaveLength(1);
    expect(chunks[0].content).toBe(text);
  });

  it("splits long text into multiple chunks", async () => {
    const strategy = tokenStrategy({ maxTokens: 10, overlap: 0 });
    const text = "word ".repeat(200); // ~200 tokens at 4 chars/token each
    const chunks = await strategy.chunk(text, "f.ts");

    expect(chunks.length).toBeGreaterThan(1);
  });

  it("all chunks carry sequential chunk_index in metadata", async () => {
    const strategy = tokenStrategy({ maxTokens: 10, overlap: 0 });
    const text = "word ".repeat(200);
    const chunks = await strategy.chunk(text, "f.ts");

    chunks.forEach((c, i) => {
      expect(c.metadata.chunk_index).toBe(i);
    });
  });

  it("prefers to break at a sentence boundary (period)", async () => {
    const strategy = tokenStrategy({ maxTokens: 20, overlap: 0 });
    // Sentence ending well within the first window
    const text = "First sentence ends here. " + "x".repeat(200);
    const chunks = await strategy.chunk(text, "f.ts");

    // The first chunk should end with the sentence, not mid-word
    expect(chunks[0].content.endsWith(".")).toBe(true);
  });

  it("produces chunks with overlap — next chunk re-includes tail of previous", async () => {
    const strategy = tokenStrategy({ maxTokens: 20, overlap: 5 });
    const text = "a".repeat(400); // no punctuation, forces plain slicing
    const chunks = await strategy.chunk(text, "f.ts");

    expect(chunks.length).toBeGreaterThan(1);
    // Overlap means each chunk's start_char < previous chunk's end_char
    for (let i = 1; i < chunks.length; i++) {
      expect(Number(chunks[i].metadata.start_char)).toBeLessThan(
        Number(chunks[i - 1].metadata.end_char),
      );
    }
  });

  it("sets sourceFile on every chunk", async () => {
    const chunks = await tokenStrategy({ maxTokens: 10, overlap: 0 }).chunk(
      "x".repeat(300),
      "src/foo.ts",
    );
    expect(chunks.every((c) => c.sourceFile === "src/foo.ts")).toBe(true);
  });

  it("extractMetadata returns char_count and estimated_tokens", () => {
    const meta = tokenStrategy().extractMetadata!("hello world");
    expect(typeof meta.char_count).toBe("number");
    expect(typeof meta.estimated_tokens).toBe("number");
    expect(Number(meta.estimated_tokens)).toBeGreaterThan(0);
  });

  it("getQualityMetrics on empty chunks returns zero metrics", () => {
    const metrics = tokenStrategy().getQualityMetrics!([]);
    expect(metrics.avgChunkSize).toBe(0);
    expect(metrics.informationDensity).toBe(0);
  });
});

// ──────────────────────────────────────────────────────────────
// markdownHeadersStrategy
// ──────────────────────────────────────────────────────────────

describe("markdownHeadersStrategy", () => {
  const strategy = markdownHeadersStrategy();

  it("strategy name is 'markdown-headers'", () => {
    expect(strategy.name).toBe("markdown-headers");
  });

  it("returns empty array for empty text", async () => {
    expect(await strategy.chunk("")).toHaveLength(0);
  });

  it("splits on h1–h6 headers, one chunk per section", async () => {
    const text = [
      "## Section One",
      "Content for section one. ".repeat(10),
      "## Section Two",
      "Content for section two. ".repeat(10),
    ].join("\n");

    const chunks = await strategy.chunk(text, "doc.md");

    expect(chunks).toHaveLength(2);
    expect(chunks[0].metadata.header).toBe("Section One");
    expect(chunks[1].metadata.header).toBe("Section Two");
  });

  it("records header_level in metadata", async () => {
    const text = "### H3 Header\n" + "body content ".repeat(20);
    const chunks = await strategy.chunk(text, "doc.md");

    expect(chunks[0].metadata.header_level).toBe(3);
  });

  it("skips sections below minChunkSize", async () => {
    const strategy100 = markdownHeadersStrategy({ minChunkSize: 100 });
    const text = "## Short\nTiny.\n## Long\n" + "long content ".repeat(20);
    const chunks = await strategy100.chunk(text, "doc.md");

    // "Short" section is too small; only "Long" survives
    expect(chunks).toHaveLength(1);
    expect(chunks[0].metadata.header).toBe("Long");
  });

  it("includes final section that has no trailing header", async () => {
    const text = "## Only Section\n" + "body content ".repeat(15);
    const chunks = await strategy.chunk(text, "doc.md");

    expect(chunks).toHaveLength(1);
    expect(chunks[0].metadata.is_last).toBe(true);
  });

  it("handles text with no headers as a headerless chunk (if >= minChunkSize)", async () => {
    const text = "No headers here. " + "x".repeat(200);
    const chunks = await strategy.chunk(text, "doc.md");

    expect(chunks).toHaveLength(1);
    expect(chunks[0].metadata.header).toBe("");
  });

  it("truncates an oversized chunk when > maxChunkSize and > 10 lines", async () => {
    const small = markdownHeadersStrategy({ maxChunkSize: 200 });
    const text = "## Big\n" + "line content\n".repeat(20);
    const chunks = await small.chunk(text, "doc.md");

    // Should produce a truncated chunk
    expect(chunks.some((c) => c.metadata.truncated === true)).toBe(true);
  });

  it("extractMetadata detects the first header and line count", () => {
    const text = "## Title\nSome body.";
    const meta = strategy.extractMetadata!(text);

    expect(meta.has_headers).toBe(true);
    expect(meta.first_header).toBe("Title");
    expect(meta.line_count).toBe(2);
  });

  it("extractMetadata reports has_headers = false for plain text", () => {
    expect(strategy.extractMetadata!("plain text").has_headers).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────────
// semanticStrategy
// ──────────────────────────────────────────────────────────────

describe("semanticStrategy", () => {
  const strategy = semanticStrategy();

  it("strategy name is 'semantic'", () => {
    expect(strategy.name).toBe("semantic");
  });

  it("returns empty array for empty text", async () => {
    expect(await strategy.chunk("")).toHaveLength(0);
  });

  it("returns a single chunk for text shorter than maxChars", async () => {
    // Use minChars: 10 so the short test text passes the minimum-size filter
    const s = semanticStrategy({ minChars: 10 });
    const text = "Short text. Only two sentences.";
    const chunks = await s.chunk(text, "f.txt");

    expect(chunks).toHaveLength(1);
  });

  it("splits at sentence boundaries when text exceeds maxChars", async () => {
    const strategy200 = semanticStrategy({ maxChars: 200, minChars: 10 });
    const text = Array.from(
      { length: 10 },
      (_, i) => `Sentence number ${i + 1} ends here.`,
    ).join(" ");
    const chunks = await strategy200.chunk(text, "f.txt");

    expect(chunks.length).toBeGreaterThan(1);
    // Every chunk should be within maxChars (±one sentence overflow)
    chunks.forEach((c) => expect(c.content.length).toBeLessThanOrEqual(300));
  });

  it("skips chunks below minChars", async () => {
    const strategy = semanticStrategy({ maxChars: 10, minChars: 100 });
    // Each sentence is short; after splitting they all fall below minChars
    const text = "Hi. Ok. Yes.";
    const chunks = await strategy.chunk(text, "f.txt");

    expect(chunks).toHaveLength(0);
  });

  it("metadata includes sentence_count", async () => {
    const text = "First. Second. Third. Fourth. Fifth. " + "x".repeat(200);
    const chunks = await semanticStrategy({
      maxChars: 100,
      minChars: 10,
    }).chunk(text, "f.txt");

    chunks.forEach((c) =>
      expect(typeof c.metadata.sentence_count).toBe("number"),
    );
  });

  it("last chunk carries is_last = true", async () => {
    const text = "Alpha. " + "x".repeat(300) + " Beta.";
    const chunks = await semanticStrategy({
      maxChars: 100,
      minChars: 10,
    }).chunk(text, "f.txt");

    expect(chunks[chunks.length - 1].metadata.is_last).toBe(true);
  });

  it("extractMetadata returns sentence_count and char_count", () => {
    const meta = strategy.extractMetadata!("Hello. World!");
    expect(typeof meta.sentence_count).toBe("number");
    expect(typeof meta.char_count).toBe("number");
  });

  it("getQualityMetrics returns valid metrics for produced chunks", async () => {
    const text = "The quick brown fox. " + "x".repeat(100) + ". The lazy dog.";
    const chunks = await semanticStrategy({ maxChars: 50, minChars: 5 }).chunk(
      text,
      "f.txt",
    );
    const metrics = strategy.getQualityMetrics!(chunks);

    expect(metrics.avgChunkSize).toBeGreaterThanOrEqual(0);
    expect(metrics.stdDevChunkSize).toBeGreaterThanOrEqual(0);
    expect(metrics.semanticCoherence).toBeGreaterThanOrEqual(0);
    expect(metrics.informationDensity).toBeGreaterThanOrEqual(0);
  });
});
