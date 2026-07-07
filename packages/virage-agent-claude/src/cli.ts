#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createAgentMcpServer } from "./server.js";
import { runInjectContext } from "./inject-context.js";

const [, , subcommand, ...rest] = process.argv;

if (subcommand === "inject-context") {
  const excerpt = rest[0] ?? "";
  const sessionId =
    parseFlag(rest, "--session-id") ?? process.env["CLAUDE_CODE_SESSION_ID"];
  const configPath = parseFlag(rest, "--config");
  await runInjectContext(excerpt, {
    sessionId,
    configPath: configPath ?? undefined,
  });
} else {
  // Default: start MCP server
  const server = createAgentMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

function parseFlag(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  return idx !== -1 ? args[idx + 1] : undefined;
}
