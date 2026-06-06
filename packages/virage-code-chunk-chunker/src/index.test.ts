import { describe, it, expect, vi, beforeEach } from "vitest";
import type { EntityInfo, ChunkEntityInfo } from "code-chunk";
import { codeChunkStrategy, ragPlugin } from "./index.js";

vi.mock("code-chunk", () => ({
  chunk: vi.fn(),
  detectLanguage: vi.fn(),
  UnsupportedLanguageError: class UnsupportedLanguageError extends Error {
    readonly _tag = "UnsupportedLanguageError";
    constructor(filepath: string) {
      super(`Unsupported language for file: ${filepath}`);
      this.name = "UnsupportedLanguageError";
    }
  },
}));

import {
  chunk as mockCodeChunk,
  detectLanguage as mockDetectLanguage,
  UnsupportedLanguageError,
} from "code-chunk";

const makeMockChunk = (
  overrides: Partial<{
    text: string;
    contextualizedText: string;
    totalChunks: number;
    scope: EntityInfo[];
    entities: ChunkEntityInfo[];
  }> = {},
) => ({
  text: overrides.text ?? "function foo() {}",
  contextualizedText:
    overrides.contextualizedText ?? "// scope: module\nfunction foo() {}",
  byteRange: { start: 0, end: 18 },
  lineRange: { start: 0, end: 0 },
  index: 0,
  totalChunks: overrides.totalChunks ?? 1,
  context: {
    scope: overrides.scope ?? [{ name: "module", type: "export" as const }],
    entities: overrides.entities ?? [
      { name: "foo", type: "function" as const },
    ],
    siblings: [],
    imports: [],
  },
});

// ─── Smoke — exports ─────────────────────────────────────────

describe("package exports", () => {
  it("exports codeChunkStrategy as a function", () => {
    expect(typeof codeChunkStrategy).toBe("function");
  });

  it("exports ragPlugin with correct shape", () => {
    expect(ragPlugin.name).toBe("code-chunk-ast");
    expect(ragPlugin.type).toBe("chunker");
    expect(typeof ragPlugin.factory).toBe("function");
  });
});

// ─── Strategy shape ──────────────────────────────────────────

describe("codeChunkStrategy() factory", () => {
  it("returns object with chunk, extractMetadata, getQualityMetrics", () => {
    const s = codeChunkStrategy();
    expect(typeof s.chunk).toBe("function");
    expect(typeof s.extractMetadata).toBe("function");
    expect(typeof s.getQualityMetrics).toBe("function");
  });

  it("strategy name is 'code-chunk-ast'", () => {
    expect(codeChunkStrategy().name).toBe("code-chunk-ast");
  });
});

// ─── chunk() — edge cases ────────────────────────────────────

describe("chunk() — edge cases", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns [] when filePath is undefined", async () => {
    const result = await codeChunkStrategy().chunk("const x = 1;");
    expect(result).toHaveLength(0);
    expect(mockCodeChunk).not.toHaveBeenCalled();
  });

  it("returns [] when code-chunk throws UnsupportedLanguageError", async () => {
    vi.mocked(mockCodeChunk).mockRejectedValueOnce(
      new UnsupportedLanguageError("file.rb"),
    );
    const result = await codeChunkStrategy().chunk("puts 'hello'", "file.rb");
    expect(result).toHaveLength(0);
  });

  it("propagates non-UnsupportedLanguageError errors", async () => {
    vi.mocked(mockCodeChunk).mockRejectedValueOnce(new Error("parse failure"));
    await expect(
      codeChunkStrategy().chunk("bad code", "file.ts"),
    ).rejects.toThrow("parse failure");
  });
});

// ─── chunk() — happy path ────────────────────────────────────

describe("chunk() — mapping", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("maps c.text to Chunk.content by default", async () => {
    vi.mocked(mockCodeChunk).mockResolvedValueOnce([makeMockChunk()]);
    const chunks = await codeChunkStrategy().chunk("code", "f.ts");
    expect(chunks[0].content).toBe("function foo() {}");
  });

  it("maps c.contextualizedText when useContextualizedText is true", async () => {
    vi.mocked(mockCodeChunk).mockResolvedValueOnce([makeMockChunk()]);
    const chunks = await codeChunkStrategy({
      useContextualizedText: true,
    }).chunk("code", "f.ts");
    expect(chunks[0].content).toBe("// scope: module\nfunction foo() {}");
  });

  it("sets sourceFile, commitHash, and strategy metadata", async () => {
    vi.mocked(mockCodeChunk).mockResolvedValueOnce([makeMockChunk()]);
    const chunks = await codeChunkStrategy().chunk("code", "src/main.ts");
    expect(chunks[0].sourceFile).toBe("src/main.ts");
    expect(chunks[0].commitHash).toBe("");
    expect(chunks[0].metadata.strategy).toBe("code-chunk-ast");
    expect(chunks[0].metadata.source_file).toBe("src/main.ts");
  });

  it("sets sequential chunk_index across multiple results", async () => {
    vi.mocked(mockCodeChunk).mockResolvedValueOnce([
      makeMockChunk({ text: "a", totalChunks: 2 }),
      makeMockChunk({ text: "b", totalChunks: 2 }),
    ]);
    const chunks = await codeChunkStrategy().chunk("ab", "f.ts");
    expect(chunks[0].metadata.chunk_index).toBe(0);
    expect(chunks[1].metadata.chunk_index).toBe(1);
  });

  it("includes scope and entities from context in metadata", async () => {
    const scope: EntityInfo[] = [{ name: "MyClass", type: "class" }];
    const entities: ChunkEntityInfo[] = [{ name: "myMethod", type: "method" }];
    vi.mocked(mockCodeChunk).mockResolvedValueOnce([
      makeMockChunk({ scope, entities }),
    ]);
    const chunks = await codeChunkStrategy().chunk("code", "f.ts");
    expect(chunks[0].metadata.scope).toEqual(scope);
    expect(chunks[0].metadata.entities).toEqual(entities);
  });

  it("passes ChunkOptions to code-chunk (not useContextualizedText)", async () => {
    vi.mocked(mockCodeChunk).mockResolvedValueOnce([]);
    await codeChunkStrategy({
      maxChunkSize: 500,
      filterImports: true,
      useContextualizedText: true,
    }).chunk("code", "f.ts");
    expect(mockCodeChunk).toHaveBeenCalledWith(
      "f.ts",
      "code",
      expect.objectContaining({ maxChunkSize: 500, filterImports: true }),
    );
    expect(mockCodeChunk).toHaveBeenCalledWith(
      "f.ts",
      "code",
      expect.not.objectContaining({ useContextualizedText: expect.anything() }),
    );
  });

  it("sets total_chunks from code-chunk result", async () => {
    vi.mocked(mockCodeChunk).mockResolvedValueOnce([
      makeMockChunk({ totalChunks: 3 }),
    ]);
    const chunks = await codeChunkStrategy().chunk("code", "f.ts");
    expect(chunks[0].metadata.total_chunks).toBe(3);
  });
});

// ─── extractMetadata() ───────────────────────────────────────

describe("extractMetadata()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns supported: true and language for known extensions", () => {
    vi.mocked(mockDetectLanguage).mockReturnValueOnce("typescript");
    const meta = codeChunkStrategy().extractMetadata!("code", "src/main.ts");
    expect(meta.supported).toBe(true);
    expect(meta.language).toBe("typescript");
    expect(meta.strategy).toBe("code-chunk-ast");
  });

  it("returns supported: false and language: 'unknown' for unsupported extensions", () => {
    vi.mocked(mockDetectLanguage).mockReturnValueOnce(null);
    const meta = codeChunkStrategy().extractMetadata!("code", "file.xyz");
    expect(meta.supported).toBe(false);
    expect(meta.language).toBe("unknown");
  });

  it("returns supported: false when filePath is undefined", () => {
    const meta = codeChunkStrategy().extractMetadata!("code");
    expect(meta.supported).toBe(false);
    expect(mockDetectLanguage).not.toHaveBeenCalled();
  });
});

// ─── getQualityMetrics() ─────────────────────────────────────

describe("getQualityMetrics()", () => {
  it("returns zero metrics for empty chunk array", () => {
    const metrics = codeChunkStrategy().getQualityMetrics!([]);
    expect(metrics.avgChunkSize).toBe(0);
    expect(metrics.stdDevChunkSize).toBe(0);
    expect(metrics.semanticCoherence).toBe(0);
    expect(metrics.informationDensity).toBe(0);
  });

  it("computes non-zero metrics from real chunk content", () => {
    const chunks = [
      {
        content: "function foo() { return 42; }",
        metadata: {},
        sourceFile: "f.ts",
        commitHash: "",
      },
      {
        content: "function bar(x: number) { return x * 2; }",
        metadata: {},
        sourceFile: "f.ts",
        commitHash: "",
      },
    ];
    const metrics = codeChunkStrategy().getQualityMetrics!(chunks);
    expect(metrics.avgChunkSize).toBeGreaterThan(0);
    expect(metrics.informationDensity).toBeGreaterThan(0);
    expect(metrics.stdDevChunkSize).toBeGreaterThanOrEqual(0);
    expect(metrics.semanticCoherence).toBeGreaterThanOrEqual(0);
  });
});

// ─── ragPlugin ───────────────────────────────────────────────

describe("ragPlugin", () => {
  it("factory() returns a strategy with correct name and chunk function", () => {
    const strategy = ragPlugin.factory();
    expect(strategy.name).toBe("code-chunk-ast");
    expect(typeof strategy.chunk).toBe("function");
  });

  it("factory() creates independent strategy instances", () => {
    expect(ragPlugin.factory()).not.toBe(ragPlugin.factory());
  });
});
