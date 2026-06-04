import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { McpContext } from "./tools.js";
import {
  handleSearch,
  handleListChunks,
  handleGetChunk,
  handleListSourceFiles,
  handleGetStats,
} from "./tools.js";

export function createMcpServer(ctx: McpContext): McpServer {
  const server = new McpServer({ name: "virage-mcp", version: "0.1.0" });

  server.tool(
    "search",
    "Semantic vector search over the indexed documents. Returns top matching chunks with similarity scores.",
    {
      query: z.string().describe("Search query text"),
      top_k: z
        .number()
        .int()
        .min(1)
        .max(50)
        .optional()
        .describe("Number of results to return (default: 5)"),
      collection: z
        .string()
        .optional()
        .describe("Optional collection name to search within"),
    },
    async (args) => {
      const results = await handleSearch(args, ctx);
      return {
        content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
      };
    },
  );

  server.tool(
    "list_chunks",
    "List indexed chunks, optionally filtered by source file.",
    {
      source_file: z.string().optional().describe("Filter by source file path"),
      limit: z
        .number()
        .int()
        .min(1)
        .max(1000)
        .optional()
        .describe("Maximum number of chunks to return (default: 100)"),
    },
    async (args) => {
      const results = await handleListChunks(args, ctx);
      return {
        content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
      };
    },
  );

  server.tool(
    "get_chunk",
    "Get a single chunk by its content hash.",
    {
      content_hash: z.string().describe("16-character hex content hash"),
    },
    async (args) => {
      const result = await handleGetChunk(args, ctx);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    },
  );

  server.tool(
    "list_source_files",
    "List all indexed source files with their chunk counts.",
    {},
    async () => {
      const results = await handleListSourceFiles({}, ctx);
      return {
        content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
      };
    },
  );

  server.tool(
    "get_stats",
    "Get index statistics: total chunks, embedding and upload status.",
    {},
    async () => {
      const result = await handleGetStats({}, ctx);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    },
  );

  return server;
}
