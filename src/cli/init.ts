import { checkbox, select, input } from "@inquirer/prompts";
import { writeFile } from "fs/promises";
import { existsSync } from "fs";

interface InitAnswers {
  strategies: string[];
  embedder: string;
  vectorStore: string;
  outputPath: string;
}

const STRATEGY_INFO: Record<
  string,
  { fn: string; description: string; patterns: string[] }
> = {
  token: {
    fn: "tokenStrategy",
    description: "Token-based chunking (source code, structured text)",
    patterns: ["src/**/*.ts", "src/**/*.js"],
  },
  markdown: {
    fn: "markdownHeadersStrategy",
    description: "Markdown header-aware chunking (documentation)",
    patterns: ["docs/**/*.md", "*.md"],
  },
  semantic: {
    fn: "semanticStrategy",
    description: "Semantic paragraph chunking (prose, articles)",
    patterns: ["**/*.txt"],
  },
  "whole-file": {
    fn: "wholeFileStrategy",
    description: "Treat each file as one chunk (small configs, YAML)",
    patterns: ["**/*.yaml", "**/*.yml"],
  },
};

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

function buildChunkersSection(strategies: string[]): string {
  if (strategies.length === 0) {
    strategies = ["token"];
  }

  const entries = strategies.map((s) => {
    const info = STRATEGY_INFO[s];
    const patterns = JSON.stringify(info.patterns);
    return `    createChunker({
      name: '${s}',
      patterns: ${patterns},
      process: async (content) => ${info.fn}()(content),
    }),`;
  });

  return entries.join("\n");
}

function generateConfig(answers: InitAnswers): string {
  const selectedStrategies =
    answers.strategies.length > 0 ? answers.strategies : ["token"];
  const strategyFns = [
    ...new Set(selectedStrategies.map((s) => STRATEGY_INFO[s].fn)),
  ];

  const imports = [
    "RAGPipelineConfig",
    "EmbeddingProvider",
    "VectorStore",
    "VectorSearchResult",
    "createChunker",
    ...strategyFns,
  ].join(", ");

  const embedderSection = buildEmbedderSection(answers.embedder);
  const vectorStoreSection = buildVectorStoreSection(answers.vectorStore);
  const chunkersSection = buildChunkersSection(selectedStrategies);

  return `import { ${imports} } from '@vivantel/rag-core';

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

  const strategies = await checkbox({
    message: "Which chunking strategies do you need?",
    choices: [
      { name: "Token (source code, structured text)", value: "token" },
      { name: "Markdown headers (documentation)", value: "markdown" },
      { name: "Semantic paragraphs (prose, articles)", value: "semantic" },
      { name: "Whole file (small configs, YAML)", value: "whole-file" },
    ],
  });

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
    strategies,
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
