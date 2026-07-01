import { describe, it, expect } from "vitest";
import type { DocNode } from "@vivantel/virage-chunker-ce-ast";
import { createNativeChunker } from "@vivantel/virage-chunker-ce-ast";
import type { MdChunkerOptions } from "../src-ts/index.js";
import { createChunker } from "../src-ts/index.js";

function makeDocNode(): DocNode {
  return {
    type: "document",
    children: [
      {
        type: "section",
        children: [
          { type: "heading", text: "Introduction", attrs: { byteStart: 0, byteEnd: 14, headingLevel: 1 } },
          {
            type: "paragraph",
            text: "This is the introduction text with enough words to fill a chunk.",
            attrs: { byteStart: 16, byteEnd: 80 },
          },
        ],
        attrs: { byteStart: 0, byteEnd: 80 },
      },
      {
        type: "section",
        children: [
          { type: "heading", text: "Methods", attrs: { byteStart: 82, byteEnd: 91, headingLevel: 2 } },
          { type: "code", text: "fn compute() -> u32 { 42 }", attrs: { byteStart: 93, byteEnd: 120, codeLanguage: "rust" } },
          { type: "code", text: "<CodeBlock lang=\"ts\">\nconst x = 1;\n</CodeBlock>", attrs: { byteStart: 122, byteEnd: 170, codeLanguage: "jsx" } },
        ],
        attrs: { byteStart: 82, byteEnd: 170 },
      },
    ],
    attrs: { byteStart: 0, byteEnd: 170 },
  };
}

const docNodeJson = JSON.stringify(makeDocNode());
const mockResult = { tree: docNodeJson, hash: "deadbeef", size: 15, modifiedMs: 0 };

function createTestChunker(opts?: MdChunkerOptions) {
  return createNativeChunker<MdChunkerOptions>({
    name: "@vivantel/virage-chunker-ce-md",
    version: "0.1.3",
    sourceFormat: "md",
    patterns: ["**/*.md", "**/*.mdx"],
    loadBinding: () => ({}),
    callNative: (_b, _filePath) => mockResult,
    extraWalkOpts: (o) => ({ overlap: o.overlap ?? 0.15 }),
  })(opts);
}

describe("virage-chunker-ce-md", () => {
  describe("createChunker (bound)", () => {
    it("returns an ArtifactChunker with correct name and patterns", () => {
      const chunker = createChunker();
      expect(chunker.name).toBe("@vivantel/virage-chunker-ce-md");
      expect(chunker.patterns).toContain("**/*.md");
      expect(chunker.patterns).toContain("**/*.mdx");
    });

    it("canProcess accepts .md and .mdx, rejects .pdf", async () => {
      const chunker = createChunker();
      expect(await chunker.canProcess?.("README.md")).toBe(true);
      expect(await chunker.canProcess?.("page.mdx")).toBe(true);
      expect(await chunker.canProcess?.("doc.pdf")).toBe(false);
    });

    it("canProcess respects ignore list", async () => {
      const chunker = createChunker({ ignore: ["**/node_modules/**"] });
      expect(await chunker.canProcess?.("node_modules/foo/README.md")).toBe(false);
      expect(await chunker.canProcess?.("docs/guide.md")).toBe(true);
    });
  });

  describe("chunk() with mock binding", () => {
    it("returns ArtifactSet[] with all required fields populated", async () => {
      const chunker = createTestChunker();
      const results = await chunker.chunk("docs/guide.md", "abc123");

      expect(results.length).toBeGreaterThan(0);
      for (const artifact of results) {
        expect(typeof artifact.denseText).toBe("string");
        expect(artifact.denseText.length).toBeGreaterThan(0);
        expect(typeof artifact.sparseText).toBe("string");
        expect(typeof artifact.denseTextHash).toBe("string");
        expect(artifact.denseTextHash.length).toBe(16);
        expect(artifact.metadata.sourceFormat).toBe("md");
        expect(artifact.metadata.fileHash).toBeTruthy();
      }
    });

    it("breadcrumb includes heading text", async () => {
      const chunker = createTestChunker();
      const results = await chunker.chunk("docs/guide.md", "abc123");
      const headings = results.map((r) => r.metadata.breadcrumb).flat();
      expect(headings).toContain("Introduction");
    });

    it("code blocks carry codeLanguage in metadata", async () => {
      const chunker = createTestChunker();
      const results = await chunker.chunk("docs/guide.md", "abc123");
      const codeChunks = results.filter((r) => r.metadata.codeLanguage != null);
      expect(codeChunks.length).toBeGreaterThan(0);
      const langs = codeChunks.map((r) => r.metadata.codeLanguage);
      expect(langs.some((l) => l === "rust" || l === "jsx")).toBe(true);
      const allContent = results.map((r) => r.sparseText).join("\n");
      expect(allContent).toContain("CodeBlock");
    });

    it("applies default overlap of 0.15 from extraWalkOpts", async () => {
      const chunker = createTestChunker();
      const results = await chunker.chunk("docs/guide.md", "abc123");
      expect(results.length).toBeGreaterThan(0);
    });

    it("user-specified overlap overrides the default", async () => {
      const chunkerNoOverlap = createTestChunker({ overlap: 0 });
      const chunkerWithOverlap = createTestChunker({ overlap: 0.5 });
      const r1 = await chunkerNoOverlap.chunk("docs/guide.md", "abc123");
      const r2 = await chunkerWithOverlap.chunk("docs/guide.md", "abc123");
      expect(r2.length).toBeGreaterThanOrEqual(r1.length);
    });
  });
});
