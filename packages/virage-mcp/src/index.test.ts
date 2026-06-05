import { describe, it, expect } from "vitest";
import { createMcpServer } from "./server.js";
import {
  handleSearch,
  handleListChunks,
  handleGetChunk,
  handleListSourceFiles,
  handleGetStats,
} from "./tools.js";

describe("package exports", () => {
  it("createMcpServer is a function", () => {
    expect(typeof createMcpServer).toBe("function");
  });

  it("tool handlers are functions", () => {
    expect(typeof handleSearch).toBe("function");
    expect(typeof handleListChunks).toBe("function");
    expect(typeof handleGetChunk).toBe("function");
    expect(typeof handleListSourceFiles).toBe("function");
    expect(typeof handleGetStats).toBe("function");
  });
});

describe("createMcpServer", () => {
  it("creates a server with registered tools", () => {
    const ctx = {
      db: {} as never,
      embedder: {} as never,
      vectorStore: {} as never,
    };
    const server = createMcpServer(ctx);
    expect(server).toBeDefined();
  });
});
