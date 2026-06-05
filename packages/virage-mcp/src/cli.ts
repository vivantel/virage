#!/usr/bin/env node
import { watch } from "fs";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  loadConfig,
  EmbeddingsDb,
  defaultEmbeddingsDb,
} from "@vivantel/virage-core";
import { createMcpServer } from "./server.js";

const configIdx = process.argv.indexOf("--config");
if (configIdx === -1 || !process.argv[configIdx + 1]) {
  process.stderr.write(
    "Usage: virage-mcp --config <path-to-virage.config.json>\n",
  );
  process.exit(1);
}
const configPath = process.argv[configIdx + 1];

const cfg = await loadConfig(configPath);

const dbPath = defaultEmbeddingsDb();
const db = new EmbeddingsDb(dbPath);
await cfg.vectorStore.initialize();

const ctx = { db, embedder: cfg.embedder, vectorStore: cfg.vectorStore };
const server = createMcpServer(ctx);
const transport = new StdioServerTransport();
await server.connect(transport);

// Watch the LanceDB directory (or any file-backed store) and reinitialize
// when the index is replaced by a fresh `virage index` run.
const lanceDbUri: string | undefined = (
  cfg.vectorStore as unknown as { uri?: string }
).uri;
if (lanceDbUri && !lanceDbUri.startsWith("db://") && !lanceDbUri.startsWith("https://")) {
  let debounce: ReturnType<typeof setTimeout> | null = null;
  try {
    watch(lanceDbUri, { recursive: false }, () => {
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(async () => {
        try {
          await cfg.vectorStore.initialize();
        } catch {
          // non-fatal — next request will retry
        }
      }, 500);
    });
  } catch {
    // directory may not exist yet; skip watching
  }
}

async function shutdown() {
  await cfg.vectorStore.close?.();
  db.close();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
