export interface BenchmarkEmbedderOptions {
  model: string;
  device: "cpu" | "webgpu";
}

export async function runBenchmarkEmbedder(
  opts: BenchmarkEmbedderOptions,
): Promise<void> {
  console.log(`🔬 Benchmarking embedder: ${opts.model}`);
  console.log(`   Device: ${opts.device}`);

  let benchmarkEmbedder: (
    modelId: string,
    options?: { device?: "cpu" | "webgpu" },
  ) => Promise<{
    model: string;
    tokensPerSec: number;
    memoryMB: number;
    firstQueryLatencyMs: number;
    dimensions: number;
  }>;

  try {
    const pkg = "@vivantel/rag-embedder-transformers";
    const mod = await import(pkg);
    benchmarkEmbedder = mod.benchmarkEmbedder as typeof benchmarkEmbedder;
  } catch {
    console.error(
      "❌ @vivantel/rag-embedder-transformers is not installed.\n" +
        "   Install it with: npm install @vivantel/rag-embedder-transformers",
    );
    process.exit(1);
  }

  console.log(
    "⏳ Running benchmark (this may take a moment for model download)...\n",
  );

  const result = await benchmarkEmbedder(opts.model, { device: opts.device });

  console.log("📊 Benchmark Results");
  console.log("─".repeat(40));
  console.log(`  Model              : ${result.model}`);
  console.log(`  Dimensions         : ${result.dimensions}`);
  console.log(`  Tokens/sec         : ${result.tokensPerSec.toLocaleString()}`);
  console.log(`  Memory delta       : ${result.memoryMB} MB`);
  console.log(`  First query latency: ${result.firstQueryLatencyMs} ms`);
  console.log("─".repeat(40));
}
