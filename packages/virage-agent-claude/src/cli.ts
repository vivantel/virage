#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createAgentMcpServer } from "./server.js";

const server = createAgentMcpServer();
const transport = new StdioServerTransport();
await server.connect(transport);
