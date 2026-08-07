import { describe, it, expect } from "vitest";
import type { DocNode } from "@vivantel/virage-chunker-ce-ast";
import { createNativeChunker } from "@vivantel/virage-chunker-ce-ast";
import type { DocxChunkerOptions } from "../src-ts/index.js";
import { createChunker } from "../src-ts/index.js";

function makeDocNode(): DocNode {
  return {
    type: "document",
    children: [
      {
        type: "section",
        children: [
          { type: "heading", text: "Executive Summary", attrs: { byteStart: 0, byteEnd: 17, headingLevel: 1 } },
          {
            type: "paragraph",
            text: "This document provides an executive overview of the quarterly results.",
            attrs: { byteStart: 19, byteEnd: 89 },
          },
        ],
        attrs: { byteStart: 0, byteEnd: 89 },
      },
      {
        type: "section",
        children: [
          { type: "heading", text: "Data Table", attrs: { byteStart: 91, byteEnd: 101, headingLevel: 2 } },
          {
            type: "table",
            children: [
              {
                type: "table-row",
                children: [
                  { type: "table-cell", text: "Product", attrs: { byteStart: 103, byteEnd: 110, tableCol: 0, breadcrumb: ["Executive Summary", "Data Table"] } },
                  { type: "table-cell", text: "Revenue", attrs: { byteStart: 112, byteEnd: 119, tableCol: 1, breadcrumb: ["Executive Summary", "Data Table"] } },
                ],
                attrs: { byteStart: 103, byteEnd: 119, tableRow: 0, isHeader: true },
              },
              {
                type: "table-row",
                children: [
                  { type: "table-cell", text: "Widget A", attrs: { byteStart: 121, byteEnd: 129, tableCol: 0, breadcrumb: ["Executive Summary", "Data Table"] } },
                  { type: "table-cell", text: "1000", attrs: { byteStart: 131, byteEnd: 135, tableCol: 1, breadcrumb: ["Executive Summary", "Data Table"] } },
                ],
                attrs: { byteStart: 121, byteEnd: 135, tableRow: 1, isHeader: false },
              },
            ],
            attrs: { byteStart: 103, byteEnd: 135 },
          },
        ],
        attrs: { byteStart: 91, byteEnd: 135 },
      },
    ],
    attrs: { byteStart: 0, byteEnd: 135 },
  };
}

const docNodeJson = JSON.stringify(makeDocNode());
const mockResult = { tree: docNodeJson, hash: "deadbeef", size: 15, modifiedMs: 0 };

function createTestChunker(opts?: DocxChunkerOptions) {
  return createNativeChunker<DocxChunkerOptions>({
    name: "@vivantel/virage-chunker-ce-docx",
    version: "0.1.2",
    sourceFormat: "docx",
    patterns: ["**/*.docx"],
    loadBinding: () => ({}),
    callNative: (_b, _filePath) => mockResult,
    extraWalkOpts: () => ({ overlap: 0.1 }),
  })(opts);
}

describe("virage-chunker-ce-docx", () => {
  describe("createChunker (bound)", () => {
    it("returns an ArtifactChunker with correct name and patterns", () => {
      const chunker = createChunker();
      expect(chunker.name).toBe("@vivantel/virage-chunker-ce-docx");
      expect(chunker.patterns).toContain("**/*.docx");
    });

    it("canProcess accepts .docx, rejects .pdf and .md", async () => {
      const chunker = createChunker();
      expect(await chunker.canProcess?.("report.docx")).toBe(true);
      expect(await chunker.canProcess?.("report.pdf")).toBe(false);
      expect(await chunker.canProcess?.("README.md")).toBe(false);
    });
  });

  describe("chunk() with mock binding", () => {
    it("returns ArtifactSet[] with valid artifact structure", async () => {
      const chunker = createTestChunker();
      const results = await chunker.chunk("report.docx", "abc123");

      expect(results.length).toBeGreaterThan(0);
      for (const artifact of results) {
        expect(artifact.denseTextHash).toBeTruthy();
        expect(artifact.denseTextHash.length).toBe(16);
        expect(artifact.metadata.sourceFormat).toBe("docx");
      }
    });

    it("breadcrumb includes section heading", async () => {
      const chunker = createTestChunker();
      const results = await chunker.chunk("report.docx", "abc123");
      const allBreadcrumbs = results.flatMap((r) => r.metadata.breadcrumb);
      expect(allBreadcrumbs).toContain("Executive Summary");
    });

    it("table cell content appears in sparseText", async () => {
      const chunker = createTestChunker();
      const results = await chunker.chunk("report.docx", "abc123");
      const tableChunks = results.filter((r) => r.sparseText.includes("Widget A"));
      expect(tableChunks.length).toBeGreaterThan(0);
    });
  });
});
