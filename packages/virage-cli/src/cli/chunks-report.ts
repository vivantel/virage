import { existsSync } from "fs";
import type { Chunk } from "@vivantel/virage-core";
import { VirageDb } from "@vivantel/virage-core";
import { createOut } from "../output.js";

type ChunkEntry = Chunk;

function computeCohesion(chunks: ChunkEntry[]): {
  cohesion: number;
  midSentenceCuts: number;
  suggestion: string;
} {
  const sentenceEnd = /[.!?\n]\s*$/;
  const midSentence = chunks.filter((c) => !sentenceEnd.test(c.sparseText));
  const cohesion = 1 - midSentence.length / chunks.length;

  const suggestion =
    cohesion < 0.5
      ? `Low cohesion — consider switching to 'semantic' strategy for better sentence boundaries`
      : cohesion < 0.8
        ? `Moderate cohesion — increase maxTokens or use 'markdown-headers' for structured content`
        : "Good cohesion";

  return { cohesion, midSentenceCuts: midSentence.length, suggestion };
}

export async function runChunksReport(
  dbPath: string,
  verbosity = 0,
): Promise<void> {
  const out = createOut(verbosity);

  if (!existsSync(dbPath)) {
    out.error(
      `No virage database found at "${dbPath}". Run 'virage index' to build the index.`,
    );
    process.exit(1);
  }

  const db = new VirageDb(dbPath);
  const chunks = db.getAllChunks();
  db.close();

  if (chunks.length === 0) {
    out.error(
      `No chunks found in "${dbPath}". Run 'virage index' to populate the database.`,
    );
    process.exit(1);
  }

  const byStrategy = new Map<string, ChunkEntry[]>();
  for (const chunk of chunks) {
    const strategy =
      ((chunk.metadata as unknown as Record<string, unknown>)?.strategy as
        string | undefined) ?? "unknown";
    const group = byStrategy.get(strategy) ?? [];
    group.push(chunk);
    byStrategy.set(strategy, group);
  }

  out.section(`📊 Chunk Cohesion Report (${chunks.length} total chunks)`);

  for (const [strategy, group] of byStrategy) {
    const sizes = group.map((c) => c.denseText.length);
    const avgSize = Math.round(sizes.reduce((s, v) => s + v, 0) / sizes.length);
    const { cohesion, midSentenceCuts, suggestion } = computeCohesion(group);

    out.divider();
    out.info(`  Strategy: ${strategy}`);
    out.info(`    Chunks          : ${group.length}`);
    out.info(`    Avg size        : ${avgSize} chars`);
    out.info(`    Cohesion        : ${(cohesion * 100).toFixed(1)}%`);
    out.info(`    Mid-sentence cuts: ${midSentenceCuts}`);
    if (cohesion >= 0.8) {
      out.success(`    ${suggestion}`);
    } else {
      out.warn(`    ${suggestion}`);
    }
  }

  out.divider();
}
