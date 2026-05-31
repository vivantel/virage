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

interface InitAnswers {
  groups: ExtGroup[];
  embedder: string;
  vectorStore: string;
  outputPath: string;
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
    case "supabase":
      return `// Install: npm install @vivantel/rag-store-supabase @supabase/supabase-js
// import { SupabaseVectorStore } from '@vivantel/rag-store-supabase';
// const vectorStore = new SupabaseVectorStore({
//   url: process.env.SUPABASE_URL!,
//   key: process.env.SUPABASE_KEY!,
//   table: 'documents',
// });

const vectorStore: VectorStore = {
  name: 'supabase',
  async initialize() {
    throw new Error('Configure your Supabase vector store — uncomment the lines above');
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
        name: "Supabase pgvector (@vivantel/rag-store-supabase)",
        value: "supabase",
      },
      { name: "Pinecone (@pinecone-database/pinecone)", value: "pinecone" },
      { name: "Custom (implement the interface yourself)", value: "custom" },
    ],
  });

  const outputPath = await input({
    message: "Output path for the config file?",
    default: "./rag.config.ts",
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

  const config = generateConfig({
    groups: selectedGroups,
    embedder,
    vectorStore,
    outputPath,
  });
  await writeFile(outputPath, config, "utf-8");

  console.log(`\n✅ Created ${outputPath}`);
  console.log("\nNext steps:");
  console.log("  1. Fill in the TODO sections in the config file");
  console.log("  2. Run `rag-update validate` to check the config");
  console.log("  3. Run `rag-update` to start indexing\n");
}
