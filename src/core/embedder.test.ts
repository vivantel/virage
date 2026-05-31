import { describe, it, expect, vi, beforeEach } from "vitest";
import { writeFile, mkdir, readFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { randomBytes } from "crypto";
import { EmbedderProcessor } from "./embedder.js";
import type { EmbeddingProvider } from "../interfaces/index.js";

function tmpDir(): string {
  return join(tmpdir(), "embedder-test-" + randomBytes(6).toString("hex"));
}

function makeChunk(content: string, sourceFile = "test.ts") {
  return { content, metadata: {}, sourceFile, commitHash: "abc123" };
}

function makeProvider(overrides: Partial<EmbeddingProvider> = {}): EmbeddingProvider {
  return {
    name: "mock",
    dimensions: 3,
    embed: vi.fn().mockResolvedValue([1, 2, 3]),
    embedBatch: vi.fn().mockImplementation(async (texts: string[]) =>
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
    const secondCall = (provider.embedBatch as ReturnType<typeof vi.fn>).mock.calls[1][0];
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
    await expect(processor.run(chunksFile)).rejects.toThrow("API error on batch 3");

    // Batches 1 and 2 were saved before the failure
    const saved = JSON.parse(await readFile(embeddingsFile, "utf-8"));
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
    await writeFile(embeddingsFile, JSON.stringify([
      { ...chunks[0], embedding: [9, 9, 9], embeddedAt: 0 },
    ]));

    const provider = makeProvider();
    const processor = new EmbedderProcessor(provider, { batchSize: 10 });
    await processor.run(chunksFile, true);

    const saved = JSON.parse(await readFile(embeddingsFile, "utf-8"));
    // force=true: existing embedding replaced, both chunks re-embedded
    expect(saved).toHaveLength(2);
    expect(saved.every((e: { embedding: number[] }) =>
      JSON.stringify(e.embedding) === JSON.stringify([1, 2, 3]),
    )).toBe(true);
  });

  it("returns empty and skips embedding when all chunks are already in embeddings.json", async () => {
    const chunk = makeChunk("hello");
    await writeFile(chunksFile, JSON.stringify([chunk]));
    await writeFile(embeddingsFile, JSON.stringify([
      { ...chunk, embedding: [1, 2, 3], embeddedAt: 0 },
    ]));

    const provider = makeProvider();
    const processor = new EmbedderProcessor(provider, { batchSize: 10 });
    const result = await processor.run(chunksFile);

    expect(result).toHaveLength(0);
    expect(provider.embedBatch).not.toHaveBeenCalled();
    expect(provider.embed).not.toHaveBeenCalled();
  });
});
