import { describe, it, expect } from "vitest";

describe("@vivantel/virage-core", () => {
  it("should export all public interfaces", async () => {
    const module = await import("./index.js");

    // Core
    expect(module.GitTracker).toBeDefined();
    expect(module.ChunkProcessor).toBeDefined();
    expect(module.EmbedderProcessor).toBeDefined();
    expect(module.Uploader).toBeDefined();
    expect(module.Orchestrator).toBeDefined();

    // Utils
    expect(module.computeContentHash).toBeDefined();
    expect(module.sleep).toBeDefined();
    expect(module.batchArray).toBeDefined();
    expect(module.extractFileName).toBeDefined();
    expect(module.extractDirectory).toBeDefined();

    // Strategies
    expect(module.tokenStrategy).toBeDefined();
    expect(module.markdownHeadersStrategy).toBeDefined();
    expect(module.semanticStrategy).toBeDefined();
    expect(module.wholeFileStrategy).toBeDefined();

    // Helpers
    expect(module.createChunker).toBeDefined();

    // Config loader
    expect(module.loadConfig).toBeDefined();
  });
});
