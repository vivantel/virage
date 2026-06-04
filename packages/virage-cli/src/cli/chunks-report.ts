import { EmbeddingsDb } from "@vivantel/virage-core";

interface ChunkEntry {
  content: string;
  metadata?: { strategy?: string; [key: string]: unknown };
}

function computeCohesion(chunks: ChunkEntry[]): {
  cohesion: number;
  midSentenceCuts: number;
  suggestion: string;
} {
  const sentenceEnd = /[.!?\n]\s*$/;
  const midSentence = chunks.filter((c) => !sentenceEnd.test(c.content));
  const cohesion = 1 - midSentence.length / chunks.length;

  const suggestion =
    cohesion < 0.5
      ? `Low cohesion — consider switching to 'semantic' strategy for better sentence boundaries`
      : cohesion < 0.8
        ? `Moderate cohesion — increase maxTokens or use 'markdown-headers' for structured content`
        : "Good cohesion";

  return { cohesion, midSentenceCuts: midSentence.length, suggestion };
}

export async function runChunksReport(dbPath: string): Promise<void> {
  const db = new EmbeddingsDb(dbPath);
  const chunks = db.getAllChunks();
  db.close();

  if (chunks.length === 0) {
    console.error(
      `❌ No chunks found in "${dbPath}".\n` +
        `   Run the pipeline first to generate chunks.`,
    );
    process.exit(1);
  }

  const byStrategy = new Map<string, ChunkEntry[]>();
  for (const chunk of chunks) {
    const strategy =
      (chunk.metadata?.strategy as string | undefined) ?? "unknown";
    const group = byStrategy.get(strategy) ?? [];
    group.push(chunk);
    byStrategy.set(strategy, group);
  }

  console.log(`\n📊 Chunk Cohesion Report (${chunks.length} total chunks)`);
  console.log("─".repeat(60));

  for (const [strategy, group] of byStrategy) {
    const sizes = group.map((c) => c.content.length);
    const avgSize = Math.round(sizes.reduce((s, v) => s + v, 0) / sizes.length);
    const { cohesion, midSentenceCuts, suggestion } = computeCohesion(group);

    console.log(`\n  Strategy: ${strategy}`);
    console.log(`    Chunks          : ${group.length}`);
    console.log(`    Avg size        : ${avgSize} chars`);
    console.log(`    Cohesion        : ${(cohesion * 100).toFixed(1)}%`);
    console.log(`    Mid-sentence cuts: ${midSentenceCuts}`);
    console.log(`    💡 ${suggestion}`);
  }

  console.log("\n" + "─".repeat(60));
}
