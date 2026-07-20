import { describe, it, expect } from "vitest";
import type { DocNode } from "@vivantel/virage-chunker-ce-ast";
import { createNativeChunker } from "@vivantel/virage-chunker-ce-ast";
import type { LatexChunkerOptions } from "../src-ts/index.js";
import { createChunker } from "../src-ts/index.js";

function makeDocNode(): DocNode {
  return {
    type: "document",
    children: [
      {
        type: "section",
        children: [
          { type: "heading", text: "Introduction", attrs: { byteStart: 0, byteEnd: 12, headingLevel: 1 } },
          { type: "paragraph", text: "This section introduces the main concepts of the paper.", attrs: { byteStart: 14, byteEnd: 70 } },
        ],
        attrs: { byteStart: 0, byteEnd: 70 },
      },
      {
        type: "section",
        children: [
          { type: "heading", text: "Methods", attrs: { byteStart: 72, byteEnd: 79, headingLevel: 2 } },
          { type: "formula", text: "E = mc^2", attrs: { byteStart: 81, byteEnd: 89 } },
          { type: "code", text: "def solve(): pass", attrs: { byteStart: 91, byteEnd: 108, codeLanguage: "python" } },
        ],
        attrs: { byteStart: 72, byteEnd: 108 },
      },
    ],
    attrs: { byteStart: 0, byteEnd: 108 },
  };
}

const docNodeJson = JSON.stringify(makeDocNode());
const mockResult = { tree: docNodeJson, hash: "deadbeef", size: 50, modifiedMs: 0 };

function createTestChunker(opts?: LatexChunkerOptions) {
  return createNativeChunker<LatexChunkerOptions>({
    name: "@vivantel/virage-chunker-ce-latex",
    version: "0.1.2",
    sourceFormat: "latex",
    patterns: ["**/*.tex", "**/*.latex"],
    loadBinding: () => ({}),
    callNative: (_b, _filePath) => mockResult,
    extraWalkOpts: () => ({ overlap: 0.1 }),
  })(opts);
}

describe("virage-chunker-ce-latex", () => {
  describe("createChunker (bound)", () => {
    it("returns an ArtifactChunker with correct name and patterns", () => {
      const chunker = createChunker();
      expect(chunker.name).toBe("@vivantel/virage-chunker-ce-latex");
      expect(chunker.patterns).toContain("**/*.tex");
      expect(chunker.patterns).toContain("**/*.latex");
    });

    it("canProcess accepts .tex and .latex, rejects .md", async () => {
      const chunker = createChunker();
      expect(await chunker.canProcess?.("paper.tex")).toBe(true);
      expect(await chunker.canProcess?.("thesis.latex")).toBe(true);
      expect(await chunker.canProcess?.("README.md")).toBe(false);
    });
  });

  describe("chunk() with mock binding", () => {
    it("returns ArtifactSet[] with valid structure", async () => {
      const chunker = createTestChunker();
      const results = await chunker.chunk("paper.tex", "abc123");

      expect(results.length).toBeGreaterThan(0);
      for (const artifact of results) {
        expect(artifact.denseTextHash).toBeTruthy();
        expect(artifact.denseTextHash.length).toBe(16);
        expect(artifact.metadata.sourceFormat).toBe("latex");
      }
    });

    it("section headings appear in breadcrumb", async () => {
      const chunker = createTestChunker();
      const results = await chunker.chunk("paper.tex", "abc123");
      const headings = results
        .flatMap((r) => r.metadata.breadcrumb)
        .filter(Boolean);
      expect(headings).toContain("Introduction");
    });

    it("formula content appears in sparseText", async () => {
      const chunker = createTestChunker();
      const results = await chunker.chunk("paper.tex", "abc123");
      const allContent = results.map((r) => r.sparseText).join("\n");
      expect(allContent).toContain("E = mc^2");
    });
  });
});
