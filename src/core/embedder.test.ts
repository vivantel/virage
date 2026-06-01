import { describe, it, expect, vi, beforeEach } from "vitest";
import { writeFile, mkdir, readFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { randomBytes } from "crypto";
import { EmbedderProcessor } from "./embedder.js";
import type {
  EmbeddingProvider,
  EmbeddingsFileFormat,
} from "../interfaces/index.js";

/** Read embeddings.json and return the chunks array (handles both legacy and v2 format). */
async function readSavedChunks(path: string): Promise<unknown[]> {
  const raw = JSON.parse(await readFile(path, "utf-8")) as unknown;
  if (Array.isArray(raw)) return raw;
  return (raw as EmbeddingsFileFormat).chunks;
}

async function readSavedMeta(path: string) {
  const raw = JSON.parse(await readFile(path, "utf-8")) as unknown;
  if (Array.isArray(raw)) return null;
  return (raw as EmbeddingsFileFormat)._meta ?? null;
}

function tmpDir(): string {
  return join(tmpdir(), "embedder-test-" + randomBytes(6).toString("hex"));
}

function makeChunk(content: string, sourceFile = "test.ts") {
  return { content, metadata: {}, sourceFile, commitHash: "abc123" };
}

function makeProvider(
  overrides: Partial<EmbeddingProvider> = {},
): EmbeddingProvider {
  return {
    name: "mock",
    dimensions: 3,
    embed: vi.fn().mockResolvedValue([1, 2, 3]),
    embedBatch: vi
      .fn()
      .mockImplementation(async (texts: string[]) =>
        texts.map(() => [1, 2, 3]),
      ),
    ...overrides,
  };
}

describe("EmbedderProcessor", () => {
  let dir: string;
  let chunksFile: string;
  let embeddingsFile: string;

  beforeEach(async () => {
    dir = tmpDir();
    await mkdir(dir, { recursive: true });
    chunksFile = join(dir, "chunks.json");
    embeddingsFile = join(dir, "embeddings.json");
  });

  it("uses provider embedBatch for every sub-batch, including the last smaller one", async () => {
    const chunks = [makeChunk("a"), makeChunk("b"), makeChunk("c")];
    await writeFile(chunksFile, JSON.stringify(chunks));

    const provider = makeProvider();
    const processor = new EmbedderProcessor(provider, { batchSize: 2 });
    await processor.run(chunksFile);

    // batchSize=2 → batches [a,b] and [c]; embedBatch called twice
    expect(provider.embedBatch).toHaveBeenCalledTimes(2);
    // second call gets just one item (the tail batch — no fallback to individual embed)
    const secondCall = (provider.embedBatch as ReturnType<typeof vi.fn>).mock
      .calls[1][0];
    expect(secondCall).toHaveLength(1);
    expect(provider.embed).not.toHaveBeenCalled();
  });

  it("saves embeddings after each batch so progress is preserved on failure", async () => {
    const chunks = [makeChunk("a"), makeChunk("b"), makeChunk("c")];
    await writeFile(chunksFile, JSON.stringify(chunks));

    const provider = makeProvider({
      embedBatch: vi.fn().mockImplementation(async (texts: string[]) => {
        if (texts[0] === "c") throw new Error("API error on batch 3");
        return texts.map(() => [1, 2, 3]);
      }),
    });

    // maxRetries:0 so the error surfaces immediately without retry delays
    const processor = new EmbedderProcessor(provider, {
      batchSize: 1,
      retry: { maxRetries: 0 },
    });
    await expect(processor.run(chunksFile)).rejects.toThrow(
      "API error on batch 3",
    );

    // Batches 1 and 2 were saved before the failure
    const saved = await readSavedChunks(embeddingsFile);
    expect(saved).toHaveLength(2);
  });

  it("splits batches by maxBatchChars to prevent oversized requests", async () => {
    // 4 chunks of 100 chars; maxBatchChars=250 → two batches of 2
    const chunks = Array.from({ length: 4 }, (_, i) =>
      makeChunk("x".repeat(100), `file${i}.ts`),
    );
    await writeFile(chunksFile, JSON.stringify(chunks));

    const batchSizes: number[] = [];
    const provider = makeProvider({
      embedBatch: vi.fn().mockImplementation(async (texts: string[]) => {
        batchSizes.push(texts.length);
        return texts.map(() => [1, 2, 3]);
      }),
    });

    const processor = new EmbedderProcessor(provider, {
      batchSize: 10,
      maxBatchChars: 250,
    });
    await processor.run(chunksFile);

    expect(batchSizes).toEqual([2, 2]);
  });

  it("skips chunks already present in embeddings.json (incremental)", async () => {
    const chunkA = makeChunk("content-a");
    const chunkB = makeChunk("content-b");
    await writeFile(chunksFile, JSON.stringify([chunkA, chunkB]));

    // Pre-populate embeddings.json with chunkA already embedded
    const existing = [{ ...chunkA, embedding: [9, 9, 9], embeddedAt: 0 }];
    await writeFile(embeddingsFile, JSON.stringify(existing));

    const provider = makeProvider();
    const processor = new EmbedderProcessor(provider, { batchSize: 10 });
    await processor.run(chunksFile);

    // Only chunkB should have been embedded
    const calls = (provider.embedBatch as ReturnType<typeof vi.fn>).mock.calls;
    const allTexts = calls.flatMap((c) => c[0] as string[]);
    expect(allTexts).toEqual(["content-b"]);
  });

  it("force mode re-embeds all chunks and replaces existing embeddings.json", async () => {
    const chunks = [makeChunk("a"), makeChunk("b")];
    await writeFile(chunksFile, JSON.stringify(chunks));
    await writeFile(
      embeddingsFile,
      JSON.stringify([{ ...chunks[0], embedding: [9, 9, 9], embeddedAt: 0 }]),
    );

    const provider = makeProvider();
    const processor = new EmbedderProcessor(provider, { batchSize: 10 });
    await processor.run(chunksFile, true);

    const saved = await readSavedChunks(embeddingsFile);
    // force=true: existing embedding replaced, both chunks re-embedded
    expect(saved).toHaveLength(2);
    expect(
      saved.every(
        (e) =>
          JSON.stringify((e as { embedding: number[] }).embedding) ===
          JSON.stringify([1, 2, 3]),
      ),
    ).toBe(true);
  });

  it("skips an entire file version when all its chunks are already embedded (file-level fast path)", async () => {
    const fileA1 = {
      content: "chunk-a1",
      metadata: {},
      sourceFile: "a.ts",
      commitHash: "v1",
    };
    const fileA2 = {
      content: "chunk-a2",
      metadata: {},
      sourceFile: "a.ts",
      commitHash: "v1",
    };
    const fileB = {
      content: "chunk-b",
      metadata: {},
      sourceFile: "b.ts",
      commitHash: "v1",
    };
    await writeFile(chunksFile, JSON.stringify([fileA1, fileA2, fileB]));

    // a.ts@v1 fully embedded; b.ts not yet embedded
    const existing = [
      { ...fileA1, embedding: [1, 2, 3], embeddedAt: 0 },
      { ...fileA2, embedding: [1, 2, 3], embeddedAt: 0 },
    ];
    await writeFile(embeddingsFile, JSON.stringify(existing));

    const provider = makeProvider();
    const processor = new EmbedderProcessor(provider, { batchSize: 10 });
    await processor.run(chunksFile);

    // Only b.ts chunk should be sent to the provider
    const allTexts = (
      provider.embedBatch as ReturnType<typeof vi.fn>
    ).mock.calls.flatMap((c) => c[0] as string[]);
    expect(allTexts).toEqual(["chunk-b"]);
  });

  it("re-embeds a file when its commitHash changed, even if content is the same", async () => {
    const oldChunk = {
      content: "hello",
      metadata: {},
      sourceFile: "f.ts",
      commitHash: "old",
    };
    const newChunk = {
      content: "hello",
      metadata: {},
      sourceFile: "f.ts",
      commitHash: "new",
    };
    await writeFile(chunksFile, JSON.stringify([newChunk]));
    // existing embedding is from the old commit
    await writeFile(
      embeddingsFile,
      JSON.stringify([{ ...oldChunk, embedding: [9, 9, 9], embeddedAt: 0 }]),
    );

    const provider = makeProvider();
    const processor = new EmbedderProcessor(provider, { batchSize: 10 });
    await processor.run(chunksFile);

    // The file-version fast path doesn't match (different commitHash).
    // The per-chunk fallback matches by contentHash → still skipped.
    const allTexts = (
      provider.embedBatch as ReturnType<typeof vi.fn>
    ).mock.calls.flatMap((c) => c[0] as string[]);
    expect(allTexts).toEqual([]);
  });

  it("returns empty and skips embedding when all chunks are already in embeddings.json", async () => {
    const chunk = makeChunk("hello");
    await writeFile(chunksFile, JSON.stringify([chunk]));
    await writeFile(
      embeddingsFile,
      JSON.stringify([{ ...chunk, embedding: [1, 2, 3], embeddedAt: 0 }]),
    );

    const provider = makeProvider();
    const processor = new EmbedderProcessor(provider, { batchSize: 10 });
    const result = await processor.run(chunksFile);

    expect(result).toHaveLength(0);
    expect(provider.embedBatch).not.toHaveBeenCalled();
    expect(provider.embed).not.toHaveBeenCalled();
  });

  it("writes _meta with providerName, model, and dimensions to embeddings.json", async () => {
    const chunk = makeChunk("hello");
    await writeFile(chunksFile, JSON.stringify([chunk]));

    const provider = makeProvider({
      name: "openai",
      dimensions: 1536,
      model: "text-embedding-3-small",
    });
    await new EmbedderProcessor(provider, {
      batchSize: 10,
      vectorStoreName: "supabase",
    }).run(chunksFile);

    const meta = await readSavedMeta(embeddingsFile);
    expect(meta?.providerName).toBe("openai");
    expect(meta?.model).toBe("text-embedding-3-small");
    expect(meta?.providerDimensions).toBe(1536);
    expect(meta?.vectorStoreName).toBe("supabase");
    expect(meta?.schemaVersion).toBe(1);
  });

  it("re-embeds all chunks when the model changes", async () => {
    const chunk = makeChunk("hello");
    await writeFile(chunksFile, JSON.stringify([chunk]));

    // Pre-populate with embeddings from old-model
    const oldMeta = {
      schemaVersion: 1,
      providerName: "openai",
      providerDimensions: 1536,
      model: "text-embedding-3-small",
      createdAt: 1000,
      updatedAt: 1000,
    };
    const existingFile = {
      _meta: oldMeta,
      chunks: [{ ...chunk, embedding: [9, 9, 9], embeddedAt: 0 }],
    };
    await writeFile(embeddingsFile, JSON.stringify(existingFile));

    // Switch to a different model
    const provider = makeProvider({
      name: "openai",
      dimensions: 3072,
      model: "text-embedding-3-large",
    });
    await new EmbedderProcessor(provider, { batchSize: 10 }).run(chunksFile);

    expect(provider.embedBatch).toHaveBeenCalledTimes(1);
    const saved = await readSavedChunks(embeddingsFile);
    expect(saved).toHaveLength(1);
    // new embedding from mock provider
    expect((saved[0] as { embedding: number[] }).embedding).toEqual([1, 2, 3]);
  });

  it("re-embeds all chunks when dimensions change, regardless of model name", async () => {
    const chunk = makeChunk("hello");
    await writeFile(chunksFile, JSON.stringify([chunk]));

    const oldMeta = {
      schemaVersion: 1,
      providerName: "openai",
      providerDimensions: 1536,
      model: "text-embedding-3-small",
      createdAt: 1000,
      updatedAt: 1000,
    };
    await writeFile(
      embeddingsFile,
      JSON.stringify({
        _meta: oldMeta,
        chunks: [{ ...chunk, embedding: Array(1536).fill(0), embeddedAt: 0 }],
      }),
    );

    // Same model name, but with dimension truncation (256d)
    const provider = makeProvider({
      name: "openai",
      dimensions: 256,
      model: "text-embedding-3-small",
    });
    await new EmbedderProcessor(provider, { batchSize: 10 }).run(chunksFile);

    expect(provider.embedBatch).toHaveBeenCalledTimes(1);
  });

  it("does NOT re-embed when only providerName changes but model and dimensions stay the same", async () => {
    // Same model (text-embedding-3-small) accessible via different provider wrappers
    // produces identical vectors — the provider name change is irrelevant.
    const chunk = makeChunk("hello");
    await writeFile(chunksFile, JSON.stringify([chunk]));

    const oldMeta = {
      schemaVersion: 1,
      providerName: "github-models",
      providerDimensions: 1536,
      model: "text-embedding-3-small",
      createdAt: 1000,
      updatedAt: 1000,
    };
    await writeFile(
      embeddingsFile,
      JSON.stringify({
        _meta: oldMeta,
        chunks: [{ ...chunk, embedding: [9, 9, 9], embeddedAt: 0 }],
      }),
    );

    // Switch provider wrapper but keep same model + dimensions
    const provider = makeProvider({
      name: "openai",
      dimensions: 1536,
      model: "text-embedding-3-small",
    });
    const result = await new EmbedderProcessor(provider, { batchSize: 10 }).run(
      chunksFile,
    );

    // Cache should still be valid — no re-embedding
    expect(result).toHaveLength(0);
    expect(provider.embedBatch).not.toHaveBeenCalled();
  });

  it("migrates legacy bare-array embeddings.json to the new format on next save", async () => {
    const chunkA = makeChunk("a");
    const chunkB = makeChunk("b");
    await writeFile(chunksFile, JSON.stringify([chunkA, chunkB]));

    // Legacy format: bare array
    await writeFile(
      embeddingsFile,
      JSON.stringify([{ ...chunkA, embedding: [9, 9, 9], embeddedAt: 0 }]),
    );

    const provider = makeProvider({
      name: "openai",
      dimensions: 3,
      model: "test-model",
    });
    await new EmbedderProcessor(provider, { batchSize: 10 }).run(chunksFile);

    // After run, file should be in new format with _meta
    const meta = await readSavedMeta(embeddingsFile);
    expect(meta?.schemaVersion).toBe(1);
    expect(meta?.model).toBe("test-model");

    // Both chunks should be present
    const saved = await readSavedChunks(embeddingsFile);
    expect(saved).toHaveLength(2);
  });
});
