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
    expect(module.makeDenseText).toBeDefined();
    expect(module.makeSparseText).toBeDefined();
    expect(module.computeDenseTextHash).toBeDefined();
    expect(module.sleep).toBeDefined();
    expect(module.batchArray).toBeDefined();
    expect(module.extractFileName).toBeDefined();
    expect(module.extractDirectory).toBeDefined();

    // Config loader
    expect(module.loadConfig).toBeDefined();
  });
});
