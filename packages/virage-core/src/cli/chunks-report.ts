import { readFile } from "fs/promises";

interface ChunksFileEntry {
  content: string;
  metadata?: { strategy?: string; [key: string]: unknown };
  sourceFile?: string;
}

function isChunkArray(val: unknown): val is ChunksFileEntry[] {
  return (
    Array.isArray(val) &&
    val.length > 0 &&
    typeof (val[0] as ChunksFileEntry).content === "string"
  );
}

function computeCohesion(chunks: ChunksFileEntry[]): {
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

export async function runChunksReport(chunksFile: string): Promise<void> {
  let raw: string;
  try {
    raw = await readFile(chunksFile, "utf-8");
  } catch {
    console.error(
      `❌ Could not read chunks file "${chunksFile}".\n` +
        `   Run the pipeline first to generate chunks.`,
    );
    process.exit(1);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    console.error(`❌ "${chunksFile}" is not valid JSON`);
    process.exit(1);
  }

  // chunks.json can be a bare array or an object with a chunks property
  let chunks: ChunksFileEntry[];
  if (isChunkArray(parsed)) {
    chunks = parsed;
  } else if (
    parsed &&
    typeof parsed === "object" &&
    "chunks" in (parsed as object) &&
    isChunkArray((parsed as { chunks: unknown }).chunks)
  ) {
    chunks = (parsed as { chunks: ChunksFileEntry[] }).chunks;
  } else {
    console.error(`❌ Unexpected chunks file format in "${chunksFile}"`);
    process.exit(1);
  }

  // Group by strategy
  const byStrategy = new Map<string, ChunksFileEntry[]>();
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
