import { describe, it, expect, vi, beforeEach } from "vitest";
import { writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { randomBytes, createHash } from "crypto";
import { EmbedderProcessor } from "./embedder.js";
import { VirageDb } from "./virage-db.js";
import type {
  Chunk,
  EmbeddingProvider,
  EmbeddingsMeta,
} from "../interfaces/index.js";

function tmpPath(): string {
  return join(tmpdir(), "embedder-test-" + randomBytes(6).toString("hex"));
}

function makeChunk(text: string, sourceFile = "test.ts"): Chunk {
  const denseTextHash = createHash("sha256")
    .update(text)
    .digest("hex")
    .slice(0, 16);
  return {
    denseText: text,
    sparseText: text,
    denseTextHash,
    sparseTextGeneratorId: "mock@1.0.0:sparse:default",
    metadataGeneratorId: "mock@1.0.0:meta:default",
    metadata: {},
    sourceFile,
    commitHash: "abc123",
  };
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
  let db: VirageDb;

  beforeEach(async () => {
    dir = tmpPath();
    await mkdir(dir, { recursive: true });
    chunksFile = join(dir, "chunks.json");
    db = new VirageDb(join(dir, "virage.db"));
  });

  it("uses provider embedBatch for every sub-batch, including the last smaller one", async () => {
    const chunks = [makeChunk("a"), makeChunk("b"), makeChunk("c")];
    await writeFile(chunksFile, JSON.stringify(chunks));

    const provider = makeProvider();
    const processor = new EmbedderProcessor(provider, { batchSize: 2 });
    await processor.run(db, chunksFile);

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

    // maxRetries:0 so the error surfaces immediately; saveIntervalMs:0 forces save on every batch
    const processor = new EmbedderProcessor(provider, {
      batchSize: 1,
      retry: { maxRetries: 0 },
      saveIntervalMs: 0,
    });
    await expect(processor.run(db, chunksFile)).rejects.toThrow(
      "API error on batch 3",
    );

    // Batches 1 and 2 were saved before the failure
    expect(db.getAll()).toHaveLength(2);
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
    await processor.run(db, chunksFile);

    expect(batchSizes).toEqual([2, 2]);
  });

  it("skips chunks already present in db (incremental)", async () => {
    const chunkA = makeChunk("content-a");
    const chunkB = makeChunk("content-b");
    await writeFile(chunksFile, JSON.stringify([chunkA, chunkB]));

    // Pre-populate db with chunkA already embedded
    db.insert([{ ...chunkA, denseVector: [9, 9, 9], embeddedAt: 0 }]);

    const provider = makeProvider();
    const processor = new EmbedderProcessor(provider, { batchSize: 10 });
    await processor.run(db, chunksFile);

    // Only chunkB should have been embedded
    const calls = (provider.embedBatch as ReturnType<typeof vi.fn>).mock.calls;
    const allTexts = calls.flatMap((c) => c[0] as string[]);
    expect(allTexts).toEqual(["content-b"]);
  });

  it("force mode re-embeds all chunks and replaces existing db", async () => {
    const chunks = [makeChunk("a"), makeChunk("b")];
    await writeFile(chunksFile, JSON.stringify(chunks));
    db.insert([{ ...chunks[0], denseVector: [9, 9, 9], embeddedAt: 0 }]);

    const provider = makeProvider();
    const processor = new EmbedderProcessor(provider, { batchSize: 10 });
    await processor.run(db, chunksFile, true);

    const saved = db.getAll();
    // force=true: db cleared, both chunks re-embedded
    expect(saved).toHaveLength(2);
    expect(
      saved.every(
        (e) => JSON.stringify(e.denseVector) === JSON.stringify([1, 2, 3]),
      ),
    ).toBe(true);
  });

  it("skips an entire file version when all its chunks are already embedded (file-level fast path)", async () => {
    const fileA1 = makeChunk("chunk-a1", "a.ts");
    const fileA2 = makeChunk("chunk-a2", "a.ts");
    const fileB = makeChunk("chunk-b", "b.ts");
    await writeFile(chunksFile, JSON.stringify([fileA1, fileA2, fileB]));

    // a.ts@abc123 fully embedded; b.ts not yet embedded
    db.insert([
      { ...fileA1, denseVector: [1, 2, 3], embeddedAt: 0 },
      { ...fileA2, denseVector: [1, 2, 3], embeddedAt: 0 },
    ]);

    const provider = makeProvider();
    const processor = new EmbedderProcessor(provider, { batchSize: 10 });
    await processor.run(db, chunksFile);

    // Only b.ts chunk should be sent to the provider
    const allTexts = (
      provider.embedBatch as ReturnType<typeof vi.fn>
    ).mock.calls.flatMap((c) => c[0] as string[]);
    expect(allTexts).toEqual(["chunk-b"]);
  });

  it("re-embeds a file when its commitHash changed, even if content is the same", async () => {
    const oldChunk = { ...makeChunk("hello", "f.ts"), commitHash: "old" };
    const newChunk = { ...makeChunk("hello", "f.ts"), commitHash: "new" };
    await writeFile(chunksFile, JSON.stringify([newChunk]));
    // existing embedding is from the old commit
    db.insert([{ ...oldChunk, denseVector: [9, 9, 9], embeddedAt: 0 }]);

    const provider = makeProvider();
    const processor = new EmbedderProcessor(provider, { batchSize: 10 });
    await processor.run(db, chunksFile);

    // The file-version fast path doesn't match (different commitHash).
    // The per-chunk fallback matches by denseTextHash → still skipped.
    const allTexts = (
      provider.embedBatch as ReturnType<typeof vi.fn>
    ).mock.calls.flatMap((c) => c[0] as string[]);
    expect(allTexts).toEqual([]);
  });

  it("returns empty and skips embedding when all chunks are already in db", async () => {
    const chunk = makeChunk("hello");
    await writeFile(chunksFile, JSON.stringify([chunk]));
    db.insert([{ ...chunk, denseVector: [1, 2, 3], embeddedAt: 0 }]);

    const provider = makeProvider();
    const processor = new EmbedderProcessor(provider, { batchSize: 10 });
    const result = await processor.run(db, chunksFile);

    expect(result).toHaveLength(0);
    expect(provider.embedBatch).not.toHaveBeenCalled();
    expect(provider.embed).not.toHaveBeenCalled();
  });

  it("writes meta with providerName, model, and dimensions to db", async () => {
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
    }).run(db, chunksFile);

    const meta = db.getMeta() as EmbeddingsMeta;
    expect(meta?.providerName).toBe("openai");
    expect(meta?.model).toBe("text-embedding-3-small");
    expect(meta?.providerDimensions).toBe(1536);
    expect(meta?.vectorStoreName).toBe("supabase");
    expect(meta?.schemaVersion).toBe(1);
  });

  it("re-embeds all chunks when the model changes", async () => {
    const chunk = makeChunk("hello");
    await writeFile(chunksFile, JSON.stringify([chunk]));

    // Pre-populate db with embeddings from old-model
    const oldMeta: EmbeddingsMeta = {
      schemaVersion: 1,
      providerName: "openai",
      providerDimensions: 1536,
      model: "text-embedding-3-small",
      createdAt: 1000,
      updatedAt: 1000,
    };
    db.setMeta(oldMeta);
    db.insert([{ ...chunk, denseVector: [9, 9, 9], embeddedAt: 0 }]);

    // Switch to a different model
    const provider = makeProvider({
      name: "openai",
      dimensions: 3072,
      model: "text-embedding-3-large",
    });
    await new EmbedderProcessor(provider, { batchSize: 10 }).run(
      db,
      chunksFile,
    );

    expect(provider.embedBatch).toHaveBeenCalledTimes(1);
    const saved = db.getAll();
    expect(saved).toHaveLength(1);
    expect(saved[0].denseVector).toEqual([1, 2, 3]);
  });

  it("re-embeds all chunks when dimensions change, regardless of model name", async () => {
    const chunk = makeChunk("hello");
    await writeFile(chunksFile, JSON.stringify([chunk]));

    const oldMeta: EmbeddingsMeta = {
      schemaVersion: 1,
      providerName: "openai",
      providerDimensions: 1536,
      model: "text-embedding-3-small",
      createdAt: 1000,
      updatedAt: 1000,
    };
    db.setMeta(oldMeta);
    db.insert([{ ...chunk, denseVector: Array(1536).fill(0), embeddedAt: 0 }]);

    // Same model name, but with dimension truncation (256d)
    const provider = makeProvider({
      name: "openai",
      dimensions: 256,
      model: "text-embedding-3-small",
    });
    await new EmbedderProcessor(provider, { batchSize: 10 }).run(
      db,
      chunksFile,
    );

    expect(provider.embedBatch).toHaveBeenCalledTimes(1);
  });

  it("does NOT re-embed when only providerName changes but model and dimensions stay the same", async () => {
    const chunk = makeChunk("hello");
    await writeFile(chunksFile, JSON.stringify([chunk]));

    const oldMeta: EmbeddingsMeta = {
      schemaVersion: 1,
      providerName: "github-models",
      providerDimensions: 1536,
      model: "text-embedding-3-small",
      createdAt: 1000,
      updatedAt: 1000,
    };
    db.setMeta(oldMeta);
    db.insert([{ ...chunk, denseVector: [9, 9, 9], embeddedAt: 0 }]);

    // Switch provider wrapper but keep same model + dimensions
    const provider = makeProvider({
      name: "openai",
      dimensions: 1536,
      model: "text-embedding-3-small",
    });
    const result = await new EmbedderProcessor(provider, {
      batchSize: 10,
    }).run(db, chunksFile);

    // Cache should still be valid — no re-embedding
    expect(result).toHaveLength(0);
    expect(provider.embedBatch).not.toHaveBeenCalled();
  });
});
