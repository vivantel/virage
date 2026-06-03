export interface BenchmarkResult {
  model: string;
  tokensPerSec: number;
  memoryMB: number;
  firstQueryLatencyMs: number;
  dimensions: number;
}

const SAMPLE_TEXTS = [
  "The quick brown fox jumps over the lazy dog.",
  "Machine learning models transform text into dense vector representations.",
  "TypeScript provides static typing for JavaScript applications.",
  "Retrieval augmented generation improves LLM accuracy with external knowledge.",
  "Vector similarity search enables semantic document retrieval at scale.",
];

const CHARS_PER_TOKEN = 4;

export async function benchmarkEmbedder(
  modelId: string,
  options: {
    sampleTexts?: string[];
    device?: "cpu" | "webgpu";
  } = {},
): Promise<BenchmarkResult> {
  const texts = options.sampleTexts ?? SAMPLE_TEXTS;
  const { TransformersEmbedder } = await import("./embedder.js");

  const embedder = new TransformersEmbedder({
    model: modelId,
    device: options.device ?? "cpu",
  });

  // Measure first-query latency (includes model load time)
  const heapBefore = process.memoryUsage().heapUsed;
  const t0 = performance.now();
  const first = await embedder.embed(texts[0]);
  const firstQueryLatencyMs = performance.now() - t0;
  const heapAfter = process.memoryUsage().heapUsed;

  // Warm-up run (already done above)
  // Throughput: embed all texts
  const t1 = performance.now();
  await embedder.embedBatch(texts);
  const batchMs = performance.now() - t1;

  const totalChars = texts.reduce((s, t) => s + t.length, 0);
  const totalTokens = Math.ceil(totalChars / CHARS_PER_TOKEN);
  const tokensPerSec = totalTokens / (batchMs / 1000);
  const memoryMB = Math.max(0, heapAfter - heapBefore) / 1024 / 1024;

  return {
    model: modelId,
    tokensPerSec: Math.round(tokensPerSec),
    memoryMB: Math.round(memoryMB * 10) / 10,
    firstQueryLatencyMs: Math.round(firstQueryLatencyMs),
    dimensions: first.length,
  };
}
