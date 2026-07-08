import { loadConfig } from "@vivantel/virage-core";
import { ansi } from "../ansi.js";
import { createOut } from "../output.js";
import { withSpinner } from "../spinner.js";
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
  minSimilarity?: number;
  verbosity: number;
}

export async function runQuery(
  queryText: string,
  opts: QueryOptions,
): Promise<void> {
  const out = createOut(opts.verbosity);
  const cfg = await loadConfig(opts.config);

  // Apply re-ranker from config, or bootstrap one if --rerank flag is set
  let reranker = cfg.search?.reranker;
  if (!reranker && opts.rerank) {
    try {
      const pkg = "@vivantel/virage-reranker-cross-encoder";
      reranker = await withSpinner("Loading reranker model", async () => {
        const mod = (await import(pkg)) as {
          createReranker: (c: Record<string, unknown>) => Reranker;
        };
        return mod.createReranker({});
      });
    } catch {
      out.error(
        "Install @vivantel/virage-reranker-cross-encoder to use --rerank:\n  npm install @vivantel/virage-reranker-cross-encoder",
      );
    }
  }

  const filter: Record<string, unknown> | undefined = opts.branch
    ? { branch: opts.branch }
    : undefined;
  const useHybrid = opts.hybrid ?? cfg.search?.hybrid ?? false;
  const hybridAlpha = opts.hybridAlpha ?? cfg.search?.hybridAlpha;
  const searchOptions: SearchOptions = {
    ...(filter ? { filter } : {}),
    ...(useHybrid ? { hybrid: true, hybridAlpha, queryText } : {}),
  };
  const oversample = cfg.search?.rerankOversample ?? 5;
  const fetchTopK = reranker ? opts.topK * oversample : opts.topK;

  out.verbose(
    `Embedder: ${cfg.embedder.model ?? "unknown"}  topK: ${fetchTopK}${reranker ? `  reranker: ${reranker.name}` : ""}`,
  );
  out.debug(
    `[query] hybrid: ${useHybrid}  oversample: ${oversample}x  branch: ${opts.branch ?? "any"}`,
  );

  const t0 = Date.now();
  const queryEmbedder = cfg.search?.queryEmbedder ?? cfg.embedder;
  let results: VectorSearchResult[] = await withSpinner(
    "Searching",
    async () => {
      await cfg.vectorStore.initialize();
      const queryEmbedding = await queryEmbedder.embed(queryText);
      return cfg.vectorStore.search(
        queryEmbedding,
        fetchTopK,
        undefined,
        searchOptions,
      );
    },
  );
  out.verbose(`Search: ${Date.now() - t0}ms — ${results.length} candidate(s)`);
  if (results.length > 0) {
    out.debug(
      `[query] top pre-rerank score: ${results[0]!.similarity.toFixed(3)}`,
    );
  }

  if (reranker) {
    const t1 = Date.now();
    results = await withSpinner("Re-ranking", () =>
      reranker!.rerank(queryText, results, opts.topK),
    );
    out.verbose(`Re-rank: ${Date.now() - t1}ms → top ${results.length}`);
  }

  // Minimum-similarity threshold (CLI flag overrides config default)
  const minSim = opts.minSimilarity ?? cfg.search?.minSimilarity;
  if (minSim !== undefined) {
    results = results.filter((r) => r.similarity >= minSim);
  }

  await cfg.vectorStore.close?.();

  if (opts.json) {
    // Raw JSON output — intentional console.log for machine-readable stdout
    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify(
        results.map((r) => ({
          denseText: r.denseText,
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
    out.info("No results found.");
    return;
  }

  const searchMode = useHybrid
    ? `hybrid (alpha=${hybridAlpha ?? 0.6})`
    : "vector";
  const rerankerInfo = reranker ? ` · reranker: ${reranker.name}` : "";
  out.info(`\nTop ${results.length} result(s) for: "${queryText}"`);
  out.dim(`Search: ${searchMode}${rerankerInfo}`);
  out.divider("─", 60, ansi.cyan);
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const branch =
      typeof r!.metadata.branch === "string" ? ` [${r!.metadata.branch}]` : "";
    out.info(
      `\n${ansi.bold}${ansi.cyan}[${i + 1}] ${r!.sourceFile ?? "unknown"}${branch}${ansi.reset}`,
    );
    out.dim(`    similarity: ${(r!.similarity * 100).toFixed(1)}%`);
    out.info(
      `\n${r!.denseText.slice(0, 400)}${r!.denseText.length > 400 ? "…" : ""}`,
    );
    out.divider("─", 60, ansi.cyan);
  }
}
