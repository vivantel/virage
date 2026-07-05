/**
 * Advanced virage.config.json equivalent in TypeScript (V2 API).
 * In practice, use virage.config.json directly — this file shows the full shape.
 */
import type { VirageConfigJson } from "@vivantel/virage-core";

const config: VirageConfigJson = {
  $schema:
    "https://unpkg.com/@vivantel/virage-core/schemas/virage.config.schema.json",
  version: "2.0.0",

  providers: {
    embedder: {
      package: "@vivantel/virage-embedder-openai",
      packageVersion: "~0.2.55",
      options: {
        apiKey: "${OPENAI_API_KEY}",
        model: "text-embedding-3-small",
        dimensions: 1536,
      },
    },
    vectorStore: {
      package: "@vivantel/virage-store-lancedb",
      packageVersion: "~0.2.70",
      options: { uri: ".virage/lancedb" },
    },
    reranker: {
      package: "@vivantel/virage-reranker-cohere",
      options: { apiKey: "${COHERE_API_KEY}" },
    },
  },

  fileSets: [
    {
      name: "docs",
      include: ["docs/**/*.md", "docs/**/*.mdx"],
      ignore: ["docs/internal/**"],
      tags: ["format:markdown"],
      tagRules: [{ match: "docs/api/**", add: ["team:platform"] }],
      chunkers: [
        {
          package: "@vivantel/virage-chunker-ce-md",
          packageVersion: "~0.1.10",
        },
      ],
    },
    {
      name: "source",
      include: ["src/**/*.ts", "src/**/*.tsx"],
      ignore: ["src/**/*.test.ts", "src/**/*.spec.ts"],
      tags: ["lang:typescript"],
      tagRules: [
        { match: "src/payments/**", add: ["team:payments", "pci-scope"] },
      ],
      chunkers: [
        {
          package: "@vivantel/virage-code-chunk-chunker",
          packageVersion: "~0.1.50",
        },
      ],
    },
  ],

  ignore: ["**/node_modules/**", "**/dist/**", "**/*.min.js", "**/*.lock"],

  agents: [{ package: "@vivantel/virage-agent-claude" }],

  search: {
    hybrid: true,
    hybridAlpha: 0.6,
    rerankOversample: 3,
  },

  pipeline: {
    rateLimitMs: 200,
    batchSize: 20,
    concurrency: 4,
    minEmbeddingBatchSize: 10,
    minUploadingBatchSize: 20,
    // embeddingsFile: "./docs/rag/embeddings.json",
    // force: true,
    // skipUpload: true,
    // dryRun: true,
  },
};

export default config;
