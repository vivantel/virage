import { checkbox, select, input } from "@inquirer/prompts";
import { writeFile } from "fs/promises";
import { existsSync } from "fs";
import { readdir } from "fs/promises";
import { join, extname } from "path";

interface ExtGroup {
  exts: string[];
  strategyFn: string;
  name: string;
}

const EXT_GROUPS: ExtGroup[] = [
  {
    exts: [".md", ".mdx"],
    strategyFn: "markdownHeadersStrategy",
    name: "markdown",
  },
  { exts: [".ts", ".tsx"], strategyFn: "tokenStrategy", name: "typescript" },
  { exts: [".js", ".jsx"], strategyFn: "tokenStrategy", name: "javascript" },
  { exts: [".py"], strategyFn: "tokenStrategy", name: "python" },
  { exts: [".go"], strategyFn: "tokenStrategy", name: "go" },
  { exts: [".cs"], strategyFn: "tokenStrategy", name: "csharp" },
  { exts: [".java"], strategyFn: "tokenStrategy", name: "java" },
  { exts: [".yaml", ".yml"], strategyFn: "wholeFileStrategy", name: "yaml" },
  { exts: [".txt"], strategyFn: "semanticStrategy", name: "text" },
];

const IGNORED_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "coverage",
  ".cache",
  ".next",
  "out",
  ".turbo",
]);

async function collectExtensions(
  dir: string,
  found: Set<string>,
): Promise<void> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (!IGNORED_DIRS.has(entry.name)) {
        await collectExtensions(join(dir, entry.name), found);
      }
    } else {
      const ext = extname(entry.name).toLowerCase();
      if (ext) found.add(ext);
    }
  }
}

export async function detectFileExtensions(cwd: string): Promise<ExtGroup[]> {
  const found = new Set<string>();
  await collectExtensions(cwd, found);
  return EXT_GROUPS.filter((g) => g.exts.some((e) => found.has(e)));
}

const STRATEGY_FN_TO_JSON: Record<string, string> = {
  markdownHeadersStrategy: "markdownHeaders",
  tokenStrategy: "token",
  wholeFileStrategy: "wholeFile",
  semanticStrategy: "semantic",
};

interface InitAnswers {
  groups: ExtGroup[];
  embedder: string;
  vectorStore: string;
  outputPath: string;
  format: "json" | "ts";
}

function buildEmbedderSection(provider: string): string {
  switch (provider) {
    case "openai":
      return `// Install: npm install openai
// import OpenAI from 'openai';
// const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const embedder: EmbeddingProvider = {
  name: 'openai',
  dimensions: 1536, // text-embedding-3-small
  async embed(text: string): Promise<number[]> {
    // const res = await openai.embeddings.create({ model: 'text-embedding-3-small', input: text });
    // return res.data[0].embedding;
    throw new Error('Configure your OpenAI embedder — uncomment and adapt the lines above');
  },
  async embedBatch(texts: string[]): Promise<number[][]> {
    // const res = await openai.embeddings.create({ model: 'text-embedding-3-small', input: texts });
    // return res.data.map(d => d.embedding);
    throw new Error('Configure your OpenAI embedder — uncomment and adapt the lines above');
  },
};`;

    case "github-models":
      return `// Requires GITHUB_TOKEN in your environment (.env or CI secret)

const embedder: EmbeddingProvider = {
  name: 'github-models',
  dimensions: 1536, // text-embedding-3-small
  async embed(text: string): Promise<number[]> {
    const res = await fetch('https://models.inference.ai.azure.com/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: \`Bearer \${process.env.GITHUB_TOKEN}\`,
      },
      body: JSON.stringify({ model: 'text-embedding-3-small', input: text }),
    });
    if (!res.ok) throw new Error(\`GitHub Models error: \${res.statusText}\`);
    const json = await res.json() as { data: Array<{ embedding: number[] }> };
    return json.data[0].embedding;
  },
};`;

    default:
      return `const embedder: EmbeddingProvider = {
  name: 'custom',
  dimensions: 1536, // update to match your model's output size
  async embed(text: string): Promise<number[]> {
    // TODO: call your embedding API and return a number[]
    void text;
    throw new Error('Not implemented');
  },
  // Optional batch method for better performance:
  // async embedBatch(texts: string[]): Promise<number[][]> {
  //   // TODO: batch embed and return number[][]
  //   throw new Error('Not implemented');
  // },
};`;
  }
}

function buildVectorStoreSection(store: string): string {
  switch (store) {
    case "postgres":
      return `// Install: npm install @vivantel/rag-store-postgres
// import { PostgresVectorStore } from '@vivantel/rag-store-postgres';
// const vectorStore = new PostgresVectorStore({ connectionString: process.env.DATABASE_URL! });

const vectorStore: VectorStore = {
  name: 'postgres',
  async initialize() {
    throw new Error('Configure your PostgreSQL vector store — uncomment the lines above');
  },
  async upsert(_docs) { throw new Error('Not implemented'); },
  async deleteBySourceFile(_files) { throw new Error('Not implemented'); },
  async getCurrentState() { return new Map(); },
  async search(_embedding, _topK) { return []; },
};`;

    case "pinecone":
      return `// Install: npm install @pinecone-database/pinecone
// import { Pinecone } from '@pinecone-database/pinecone';
// const pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY! });
// const index = pc.index(process.env.PINECONE_INDEX!);

const vectorStore: VectorStore = {
  name: 'pinecone',
  async initialize() {
    throw new Error('Configure your Pinecone vector store — uncomment the lines above');
  },
  async upsert(_docs) { throw new Error('Not implemented'); },
  async deleteBySourceFile(_files) { throw new Error('Not implemented'); },
  async getCurrentState() { return new Map(); },
  async search(_embedding, _topK) { return []; },
};`;

    default:
      return `const vectorStore: VectorStore = {
  name: 'custom',
  async initialize(): Promise<void> {
    // TODO: initialize your vector store connection
  },
  async upsert(docs): Promise<void> {
    // TODO: store \`docs\` in your vector database
    void docs;
  },
  async deleteBySourceFile(files): Promise<void> {
    // TODO: remove all documents whose sourceFile is in \`files\`
    void files;
  },
  async getCurrentState(): Promise<Map<string, string>> {
    // TODO: return Map<sourceFile, commitHash> of what is currently stored
    return new Map();
  },
  async search(embedding, topK): Promise<VectorSearchResult[]> {
    // TODO: return the topK most similar documents
    void embedding; void topK;
    return [];
  },
};`;
  }
}

function buildChunkersSection(groups: ExtGroup[]): string {
  if (groups.length === 0) {
    groups = [EXT_GROUPS.find((g) => g.name === "typescript")!];
  }

  return groups
    .map((g) => {
      const patterns = JSON.stringify(g.exts.map((e) => `**/*${e}`));
      return `    createChunker({ patterns: ${patterns}, strategy: ${g.strategyFn}() }),`;
    })
    .join("\n");
}

function generateJsonConfig(answers: InitAnswers): string {
  const effectiveGroups =
    answers.groups.length > 0
      ? answers.groups
      : [EXT_GROUPS.find((g) => g.name === "typescript")!];

  const chunkers = effectiveGroups.map((g) => {
    const strategyName = STRATEGY_FN_TO_JSON[g.strategyFn] ?? g.strategyFn;
    return {
      name: g.name,
      patterns: g.exts.map((e) => `**/*${e}`),
      strategy: strategyName,
    };
  });

  let embedderPackage: string;
  let embedderConfig: Record<string, unknown>;
  switch (answers.embedder) {
    case "openai":
      embedderPackage = "@vivantel/rag-embedder-openai";
      embedderConfig = {
        apiKey: "${OPENAI_API_KEY}",
        model: "text-embedding-3-small",
        dimensions: 1536,
      };
      break;
    case "github-models":
      embedderPackage = "@vivantel/rag-embedder-openai";
      embedderConfig = {
        apiKey: "${GITHUB_TOKEN}",
        baseURL: "https://models.github.ai/inference",
        model: "openai/text-embedding-3-small",
        dimensions: 1536,
      };
      break;
    default:
      embedderPackage = "@your-org/rag-embedder-custom";
      embedderConfig = {
        apiKey: "${YOUR_API_KEY}",
        model: "your-model-name",
        dimensions: 1536,
      };
  }

  let vectorStorePackage: string;
  let vectorStoreConfig: Record<string, unknown>;
  switch (answers.vectorStore) {
    case "postgres":
      vectorStorePackage = "@vivantel/rag-store-postgres";
      vectorStoreConfig = {
        connectionString: "${DATABASE_URL}",
      };
      break;
    case "pinecone":
      vectorStorePackage = "@vivantel/rag-store-pinecone";
      vectorStoreConfig = {
        apiKey: "${PINECONE_API_KEY}",
        index: "${PINECONE_INDEX}",
      };
      break;
    default:
      vectorStorePackage = "@your-org/rag-store-custom";
      vectorStoreConfig = {};
  }

  const config = {
    $schema: "./node_modules/@vivantel/rag-core/schemas/rag.config.schema.json",
    chunkers,
    embedder: { package: embedderPackage, config: embedderConfig },
    vectorStore: { package: vectorStorePackage, config: vectorStoreConfig },
    options: {
      chunksFile: "./docs/rag/chunks.json",
      embeddingsFile: "./docs/rag/embeddings.json",
    },
  };

  return JSON.stringify(config, null, 2) + "\n";
}

function generateConfig(answers: InitAnswers): string {
  const strategyFns = [...new Set(answers.groups.map((g) => g.strategyFn))];
  if (strategyFns.length === 0) strategyFns.push("tokenStrategy");

  const valueImports = ["createChunker", ...strategyFns].join(", ");

  const embedderSection = buildEmbedderSection(answers.embedder);
  const vectorStoreSection = buildVectorStoreSection(answers.vectorStore);
  const chunkersSection = buildChunkersSection(answers.groups);

  return `import type { RAGPipelineConfig, EmbeddingProvider, VectorStore, VectorSearchResult } from '@vivantel/rag-core';
import { ${valueImports} } from '@vivantel/rag-core';

${embedderSection}

${vectorStoreSection}

const config: RAGPipelineConfig = {
  chunkers: [
${chunkersSection}
  ],
  embedder,
  vectorStore,
  options: {
    chunksFile: './docs/rag/chunks.json',
    embeddingsFile: './docs/rag/embeddings.json',
  },
};

export default config;
`;
}

export async function runInit(): Promise<void> {
  console.log("\n🚀 RAG Config Generator\n");

  console.log("Scanning project for file types...");
  const detectedGroups = await detectFileExtensions(process.cwd());

  let selectedGroups: ExtGroup[];

  if (detectedGroups.length > 0) {
    const confirmed = await checkbox({
      message: "Detected file types — select which to index:",
      choices: detectedGroups.map((g) => ({
        name: `${g.name} (${g.exts.join(", ")}) → ${g.strategyFn}`,
        value: g,
        checked: true,
      })),
    });
    selectedGroups = confirmed as ExtGroup[];
  } else {
    console.log("No known file types detected. Choose strategies manually:");
    const strategyNames = await checkbox({
      message: "Which chunking strategies do you need?",
      choices: EXT_GROUPS.map((g) => ({
        name: `${g.name} (${g.strategyFn})`,
        value: g,
      })),
    });
    selectedGroups = strategyNames as ExtGroup[];
  }

  const embedder = await select({
    message: "Which embedding provider?",
    choices: [
      { name: "OpenAI (text-embedding-3-small)", value: "openai" },
      {
        name: "GitHub Models (Azure-compatible endpoint)",
        value: "github-models",
      },
      { name: "Custom (implement the interface yourself)", value: "custom" },
    ],
  });

  const vectorStore = await select({
    message: "Which vector store?",
    choices: [
      {
        name: "PostgreSQL / pgvector (@vivantel/rag-store-postgres)",
        value: "postgres",
      },
      { name: "Pinecone (@pinecone-database/pinecone)", value: "pinecone" },
      { name: "Custom (implement the interface yourself)", value: "custom" },
    ],
  });

  const format = (await select({
    message: "Which config format?",
    choices: [
      {
        name: "JSON (rag.config.json) — declarative, no TypeScript required (recommended)",
        value: "json",
      },
      {
        name: "TypeScript (rag.config.ts) — escape hatch for custom providers",
        value: "ts",
      },
    ],
  })) as "json" | "ts";

  const defaultOutput =
    format === "json" ? "./rag.config.json" : "./rag.config.ts";
  const outputPath = await input({
    message: "Output path for the config file?",
    default: defaultOutput,
  });

  if (existsSync(outputPath)) {
    const overwrite = await select({
      message: `${outputPath} already exists. Overwrite?`,
      choices: [
        { name: "Yes, overwrite", value: "yes" },
        { name: "No, cancel", value: "no" },
      ],
    });
    if (overwrite === "no") {
      console.log("\n❌ Cancelled.");
      return;
    }
  }

  const answers: InitAnswers = {
    groups: selectedGroups,
    embedder,
    vectorStore,
    outputPath,
    format,
  };

  const config =
    format === "json" ? generateJsonConfig(answers) : generateConfig(answers);
  await writeFile(outputPath, config, "utf-8");

  console.log(`\n✅ Created ${outputPath}`);
  if (format === "json") {
    console.log("\nNext steps:");
    console.log(
      "  1. Install the embedder package: npm install @vivantel/rag-embedder-openai",
    );
    console.log("  2. Install the vector store package (when available)");
    console.log("  3. Add the required env vars to your .env file");
    console.log("  4. Run `rag-update` to start indexing\n");
  } else {
    console.log("\nNext steps:");
    console.log("  1. Fill in the TODO sections in the config file");
    console.log("  2. Run `rag-update validate` to check the config");
    console.log("  3. Run `rag-update` to start indexing\n");
  }
}
