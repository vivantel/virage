import { describe, it, expect } from "vitest";
import type { DocNode } from "@vivantel/virage-chunker-ce-ast";
import { createNativeChunker } from "@vivantel/virage-chunker-ce-ast";
import type { PdfChunkerOptions } from "../src-ts/index.js";
import { createChunker } from "../src-ts/index.js";

function makeDocNode(text: string): DocNode {
  return {
    type: "document",
    children: [
      {
        type: "heading",
        text: "Introduction",
        attrs: { byteStart: 0, byteEnd: 12, headingLevel: 1 },
      },
      {
        type: "paragraph",
        text,
        attrs: { byteStart: 13, byteEnd: 13 + text.length },
      },
    ],
    attrs: { byteStart: 0, byteEnd: 13 + text.length },
  };
}

const SAMPLE_TEXT =
  "This is a paragraph with enough content that it can produce a meaningful chunk for testing.";
const docNodeJson = JSON.stringify(makeDocNode(SAMPLE_TEXT));
const mockResult = { tree: docNodeJson, hash: "deadbeef", size: 14, modifiedMs: 0 };

function createTestChunker(opts?: PdfChunkerOptions) {
  return createNativeChunker<PdfChunkerOptions>({
    name: "@vivantel/virage-chunker-ce-pdf",
    version: "0.1.5",
    sourceFormat: "pdf",
    patterns: ["**/*.pdf"],
    loadBinding: () => ({}),
    callNative: (_b, _filePath) => mockResult,
  })(opts);
}

describe("virage-chunker-ce-pdf", () => {
  describe("createChunker (bound)", () => {
    it("returns an ArtifactChunker with correct name and patterns", () => {
      const chunker = createChunker();
      expect(chunker.name).toBe("@vivantel/virage-chunker-ce-pdf");
      expect(chunker.patterns).toContain("**/*.pdf");
    });

    it("canProcess returns true for .pdf, false for other extensions", async () => {
      const chunker = createChunker();
      expect(await chunker.canProcess?.("docs/report.pdf")).toBe(true);
      expect(await chunker.canProcess?.("docs/report.PDF")).toBe(false);
      expect(await chunker.canProcess?.("docs/image.png")).toBe(false);
    });

    it("canProcess respects the ignore list", async () => {
      const chunker = createChunker({ ignore: ["**/private/**"] });
      expect(await chunker.canProcess?.("private/secret.pdf")).toBe(false);
      expect(await chunker.canProcess?.("docs/public.pdf")).toBe(true);
    });
  });

  describe("createTestChunker (mock loadBinding)", () => {
    it("chunk() returns ArtifactSet[] with all required fields populated", async () => {
      const chunker = createTestChunker();
      const results = await chunker.chunk("report.pdf", "abc123");

      expect(results.length).toBeGreaterThan(0);
      for (const artifact of results) {
        expect(typeof artifact.denseText).toBe("string");
        expect(artifact.denseText.length).toBeGreaterThan(0);
        expect(typeof artifact.sparseText).toBe("string");
        expect(typeof artifact.denseTextHash).toBe("string");
        expect(artifact.denseTextHash.length).toBe(16);
        expect(artifact.metadata.sourceFile).toBe("report.pdf");
        expect(artifact.metadata.sourceFormat).toBe("pdf");
        expect(artifact.metadata.fileHash).toBeTruthy();
        expect(artifact.metadata.fileSizeBytes).toBe(14);
      }
    });

    it("denseText includes breadcrumb from heading", async () => {
      const chunker = createTestChunker();
      const results = await chunker.chunk("report.pdf", "abc123");
      const first = results[0]!;
      expect(first.denseText).toContain("Introduction");
    });

    it("native binding is loaded lazily (only on first chunk call)", async () => {
      let callCount = 0;
      const testChunker = createNativeChunker<PdfChunkerOptions>({
        name: "@vivantel/virage-chunker-ce-pdf",
        version: "0.1.5",
        sourceFormat: "pdf",
        patterns: ["**/*.pdf"],
        loadBinding: () => {
          callCount++;
          return {};
        },
        callNative: (_b, _filePath) => mockResult,
      })();

      expect(callCount).toBe(0);
      await testChunker.chunk("a.pdf", "h1");
      expect(callCount).toBe(1);
      await testChunker.chunk("b.pdf", "h2");
      expect(callCount).toBe(1); // not called again
    });

    it("integration test skipped when native binary is absent", async () => {
      // Full round-trip test: build the Rust binary first with `npx napi build --release`
      // then run this test with the fixture PDF in __test__/fixtures/sample.pdf
    });
  });
});
