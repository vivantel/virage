import { describe, it, expect, vi, beforeEach } from "vitest";
import type { EntityInfo, ChunkEntityInfo } from "code-chunk";
import { createChunker } from "./index.js";

vi.mock("fs/promises", () => ({
  readFile: vi.fn().mockResolvedValue("function foo() {}"),
}));

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

// ─── Factory ─────────────────────────────────────────────────

describe("createChunker() factory", () => {
  it("returns a FileChunker with required fields", () => {
    const chunker = createChunker();
    expect(chunker.name).toBe("code-chunk-ast");
    expect(typeof chunker.version).toBe("string");
    expect(Array.isArray(chunker.patterns)).toBe(true);
    expect(typeof chunker.sparseTextId).toBe("string");
    expect(typeof chunker.contextTextHash).toBe("string");
    expect(typeof chunker.chunk).toBe("function");
    expect(typeof chunker.canProcess).toBe("function");
  });

  it("different option sets produce different sparseTextId", () => {
    const a = createChunker({ maxChunkSize: 500 });
    const b = createChunker({ maxChunkSize: 1000 });
    expect(a.sparseTextId).not.toBe(b.sparseTextId);
  });
});

// ─── canProcess() ────────────────────────────────────────────

describe("canProcess()", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns true when detectLanguage returns a language", async () => {
    vi.mocked(mockDetectLanguage).mockReturnValueOnce("typescript");
    expect(await createChunker().canProcess!("src/main.ts")).toBe(true);
  });

  it("returns false when detectLanguage returns null", async () => {
    vi.mocked(mockDetectLanguage).mockReturnValueOnce(null);
    expect(await createChunker().canProcess!("file.xyz")).toBe(false);
  });
});

// ─── chunk() — happy path ────────────────────────────────────

describe("chunk() — four-artifact mapping", () => {
  beforeEach(() => vi.clearAllMocks());

  it("maps c.text to sparseText and contextText to contextualizedText", async () => {
    vi.mocked(mockCodeChunk).mockResolvedValueOnce([makeMockChunk()]);
    const [c] = await createChunker().chunk("f.ts", "abc123");
    expect(c.sparseText).toBe("function foo() {}");
    expect(c.contextText).toBe("// scope: module\nfunction foo() {}");
  });

  it("denseText uses scope breadcrumb + sparseText by default", async () => {
    vi.mocked(mockCodeChunk).mockResolvedValueOnce([
      makeMockChunk({ scope: [{ name: "MyClass", type: "class" }] }),
    ]);
    const [c] = await createChunker().chunk("f.ts", "abc123");
    expect(c.denseText).toContain("MyClass");
    expect(c.denseText).toContain("function foo() {}");
  });

  it("denseText equals contextualizedText when useContextualizedText is true", async () => {
    vi.mocked(mockCodeChunk).mockResolvedValueOnce([makeMockChunk()]);
    const [c] = await createChunker({ useContextualizedText: true }).chunk(
      "f.ts",
      "abc123",
    );
    expect(c.denseText).toBe("// scope: module\nfunction foo() {}");
  });

  it("denseTextHash is a 16-char hex string", async () => {
    vi.mocked(mockCodeChunk).mockResolvedValueOnce([makeMockChunk()]);
    const [c] = await createChunker().chunk("f.ts", "abc123");
    expect(c.denseTextHash).toMatch(/^[0-9a-f]{16}$/);
  });

  it("sets sourceFile and commitHash from arguments", async () => {
    vi.mocked(mockCodeChunk).mockResolvedValueOnce([makeMockChunk()]);
    const [c] = await createChunker().chunk("src/main.ts", "deadbeef");
    expect(c.sourceFile).toBe("src/main.ts");
    expect(c.commitHash).toBe("deadbeef");
  });

  it("sets metadata.strategy and index fields", async () => {
    vi.mocked(mockCodeChunk).mockResolvedValueOnce([
      makeMockChunk({ totalChunks: 3 }),
    ]);
    const [c] = await createChunker().chunk("f.ts", "");
    const meta = c.metadata as unknown as Record<string, unknown>;
    expect(meta.strategy).toBe("code-chunk-ast");
    expect(meta.chunkIndex).toBe(0);
    expect(meta.totalChunks).toBe(3);
  });

  it("passes ChunkOptions to code-chunk (not useContextualizedText)", async () => {
    vi.mocked(mockCodeChunk).mockResolvedValueOnce([]);
    await createChunker({
      maxChunkSize: 500,
      filterImports: true,
      useContextualizedText: true,
    }).chunk("f.ts", "");
    expect(mockCodeChunk).toHaveBeenCalledWith(
      "f.ts",
      expect.any(String),
      expect.objectContaining({ maxChunkSize: 500, filterImports: true }),
    );
    expect(mockCodeChunk).toHaveBeenCalledWith(
      "f.ts",
      expect.any(String),
      expect.not.objectContaining({
        useContextualizedText: expect.anything(),
      }),
    );
  });
});

// ─── chunk() — error handling ────────────────────────────────

describe("chunk() — edge cases", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns [] when code-chunk throws UnsupportedLanguageError", async () => {
    vi.mocked(mockCodeChunk).mockRejectedValueOnce(
      new UnsupportedLanguageError("file.rb"),
    );
    const result = await createChunker().chunk("file.rb", "");
    expect(result).toHaveLength(0);
  });

  it("propagates non-UnsupportedLanguageError errors", async () => {
    vi.mocked(mockCodeChunk).mockRejectedValueOnce(new Error("parse failure"));
    await expect(createChunker().chunk("file.ts", "")).rejects.toThrow(
      "parse failure",
    );
  });
});
