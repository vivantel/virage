#!/usr/bin/env node
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

const dbPath =
  (
    cfg.options as { embeddingsFile?: string } | undefined
  )?.embeddingsFile?.replace(/\.json$/, ".db") ?? defaultEmbeddingsDb();

const db = new EmbeddingsDb(dbPath);
await cfg.vectorStore.initialize();

const ctx = { db, embedder: cfg.embedder, vectorStore: cfg.vectorStore };
const server = createMcpServer(ctx);
const transport = new StdioServerTransport();
await server.connect(transport);

process.on("SIGINT", () => {
  db.close();
  process.exit(0);
});
process.on("SIGTERM", () => {
  db.close();
  process.exit(0);
});
