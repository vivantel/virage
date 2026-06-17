import { loadConfig } from "@vivantel/virage-core";
import type {
  VectorSearchResult,
  SearchOptions,
  Reranker,
} from "@vivantel/virage-core";

export interface QueryOptions {
  config: string;
  topK: number;
  json: boolean;
  branch?: string;
  hybrid?: boolean;
  hybridAlpha?: number;
  rerank?: boolean;
}

export async function runQuery(
  queryText: string,
  opts: QueryOptions,
): Promise<void> {
  const cfg = await loadConfig(opts.config);

  await cfg.vectorStore.initialize();
  const queryEmbedding = await cfg.embedder.embed(queryText);

  const filter: Record<string, unknown> | undefined = opts.branch
    ? { branch: opts.branch }
    : undefined;

  const useHybrid = opts.hybrid ?? cfg.search?.hybrid ?? false;
  const hybridAlpha = opts.hybridAlpha ?? cfg.search?.hybridAlpha;

  const searchOptions: SearchOptions = {
    ...(filter ? { filter } : {}),
    ...(useHybrid ? { hybrid: true, hybridAlpha, queryText } : {}),
  };

  let results: VectorSearchResult[] = await cfg.vectorStore.search(
    queryEmbedding,
    opts.topK,
    undefined,
    searchOptions,
  );

  // Apply re-ranker from config, or bootstrap one if --rerank flag is set
  let reranker = cfg.search?.reranker;
  if (!reranker && opts.rerank) {
    try {
      const pkg = "@vivantel/virage-reranker-cross-encoder";
      const mod = (await import(pkg)) as {
        createReranker: (c: Record<string, unknown>) => Reranker;
      };
      reranker = mod.createReranker({});
    } catch {
      console.error(
        "Install @vivantel/virage-reranker-cross-encoder to use --rerank:\n  npm install @vivantel/virage-reranker-cross-encoder",
      );
    }
  }

  if (reranker) {
    results = await reranker.rerank(queryText, results, opts.topK);
  }

  await cfg.vectorStore.close?.();

  if (opts.json) {
    console.log(
      JSON.stringify(
        results.map((r) => ({
          content: r.content,
          sourceFile: r.sourceFile,
          similarity: r.similarity,
          metadata: r.metadata,
        })),
        null,
        2,
      ),
    );
    return;
  }

  if (results.length === 0) {
    console.log("No results found.");
    return;
  }

  console.log(`\nTop ${results.length} result(s) for: "${queryText}"\n`);
  console.log("─".repeat(60));
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const branch =
      typeof r.metadata.branch === "string" ? ` [${r.metadata.branch}]` : "";
    console.log(`\n[${i + 1}] ${r.sourceFile ?? "unknown"}${branch}`);
    console.log(`    similarity: ${(r.similarity * 100).toFixed(1)}%`);
    console.log(
      `\n${r.content.slice(0, 400)}${r.content.length > 400 ? "…" : ""}`,
    );
    console.log("\n" + "─".repeat(60));
  }
}
