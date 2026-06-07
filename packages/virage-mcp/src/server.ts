import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { TelemetryConfig } from "@vivantel/virage-core";
import type { McpContext } from "./tools.js";
import {
  handleSearch,
  handleListChunks,
  handleGetChunk,
  handleListSourceFiles,
  handleGetStats,
  handleRagFeedback,
} from "./tools.js";

export function createMcpServer(
  ctx: McpContext,
  telemetryConfig?: TelemetryConfig,
): McpServer {
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

  if (telemetryConfig?.tiers.explicit_feedback.enabled) {
    server.tool(
      "rag_feedback",
      "Evaluate the quality of the last search results. " +
        "Call when: search returned 0 results, more than 10 results, results were " +
        "insufficient to answer, or user corrected your answer. " +
        "Skip for clearly successful searches.",
      {
        search_query_id: z
          .string()
          .optional()
          .describe(
            "ID of the search to evaluate (omit to use the most recent search)",
          ),
        was_useful: z
          .boolean()
          .describe("Whether the search results were useful"),
        metrics: z
          .object({
            context_relevance: z
              .number()
              .min(0)
              .max(1)
              .optional()
              .describe("Fraction of results relevant to the query (0–1)"),
            context_completeness: z
              .number()
              .min(0)
              .max(1)
              .optional()
              .describe("How completely the results covered the topic (0–1)"),
            noise_ratio: z
              .number()
              .min(0)
              .max(1)
              .optional()
              .describe("Fraction of results that were irrelevant (0–1)"),
            missing_category: z
              .enum([
                "missing_error_handling",
                "missing_config_example",
                "missing_api_reference",
                "missing_type_signature",
                "missing_test_coverage",
                "other",
              ])
              .optional()
              .describe("Category of missing information when not useful"),
          })
          .optional(),
      },
      async (args) => {
        handleRagFeedback(args, ctx);
        return {
          content: [{ type: "text", text: JSON.stringify({ ok: true }) }],
        };
      },
    );
  }

  return server;
}
