import { describe, it, expect } from "vitest";
import type { DocNode, ParseResult } from "@vivantel/virage-chunker-ce-ast";
import { createNativeChunker } from "@vivantel/virage-chunker-ce-ast";
import type { LangChunkerOptions } from "../src-ts/index.js";
import { createChunker } from "../src-ts/index.js";

function makeCodeDocNode(): DocNode {
  return {
    type: "document",
    children: [
      {
        type: "section",
        text: "def greet(name: str) -> str",
        children: [
          {
            type: "paragraph",
            text: "Say hello to the user.",
            attrs: { byteStart: 4, byteEnd: 40 },
          },
        ],
        attrs: {
          byteStart: 0,
          byteEnd: 80,
          headingLevel: 1,
          codeLanguage: "python",
          sourceFormat: "code",
          breadcrumb: [],
        },
      },
      {
        type: "section",
        text: "class Greeter",
        children: [
          {
            type: "section",
            text: "def __init__(self, name: str)",
            children: [],
            attrs: {
              byteStart: 85,
              byteEnd: 130,
              headingLevel: 2,
              codeLanguage: "python",
              sourceFormat: "code",
              breadcrumb: ["class Greeter"],
            },
          },
        ],
        attrs: {
          byteStart: 82,
          byteEnd: 200,
          headingLevel: 1,
          codeLanguage: "python",
          sourceFormat: "code",
          breadcrumb: [],
        },
      },
    ],
    attrs: {
      byteStart: 0,
      byteEnd: 200,
      sourceFormat: "code",
      codeLanguage: "python",
    },
  };
}

const docNodeJson = JSON.stringify(makeCodeDocNode());
const mockResult: ParseResult = { tree: docNodeJson, hash: "cafebabe", size: 200, modifiedMs: 0 };

function createTestChunker(opts?: LangChunkerOptions) {
  return createNativeChunker<LangChunkerOptions>({
    name: "@vivantel/virage-chunker-ce-lang",
    version: "0.1.0",
    sourceFormat: "code",
    patterns: ["**/*.py", "**/*.ts", "**/*.js", "**/*.rs"],
    loadBinding: () => ({}),
    callNative: (_b, _filePath) => mockResult,
  })(opts);
}

describe("virage-chunker-ce-lang", () => {
  describe("createChunker (bound)", () => {
    it("returns an ArtifactChunker with correct name and patterns", () => {
      const chunker = createChunker();
      expect(chunker.name).toBe("@vivantel/virage-chunker-ce-lang");
      expect(chunker.patterns).toContain("**/*.py");
      expect(chunker.patterns).toContain("**/*.ts");
      expect(chunker.patterns).toContain("**/*.js");
      expect(chunker.patterns).toContain("**/*.rs");
      expect(chunker.patterns).toContain("**/*.go");
      expect(chunker.patterns).toContain("**/*.java");
      expect(chunker.patterns).toContain("**/*.cs");
      expect(chunker.patterns).toContain("**/*.rb");
      expect(chunker.patterns).toContain("**/*.c");
      expect(chunker.patterns).toContain("**/*.cpp");
    });

    it("canProcess returns true for supported extensions", async () => {
      const chunker = createChunker();
      const supported = [
        "src/app.py", "lib/util.js", "src/index.ts",
        "main.go", "Main.java", "src/lib.rs",
        "utils.c", "vector.cpp", "Service.cs", "script.rb",
      ];
      for (const path of supported) {
        expect(await chunker.canProcess?.(path)).toBe(true);
      }
    });

    it("canProcess returns false for unsupported extensions", async () => {
      const chunker = createChunker();
      const unsupported = ["README.md", "report.pdf", "data.csv", "image.png"];
      for (const path of unsupported) {
        expect(await chunker.canProcess?.(path)).toBe(false);
      }
    });

    it("canProcess respects the ignore list", async () => {
      const chunker = createChunker({ ignore: ["**/*.spec.*", "**/*.test.*"] });
      expect(await chunker.canProcess?.("src/app.spec.ts")).toBe(false);
      expect(await chunker.canProcess?.("src/app.test.py")).toBe(false);
      expect(await chunker.canProcess?.("src/app.ts")).toBe(true);
    });
  });

  describe("chunk() with mock binding", () => {
    it("returns ArtifactSet[] with all artifacts populated", async () => {
      const chunker = createTestChunker();
      const results = await chunker.chunk("src/app.py", "abc123");

      expect(results.length).toBeGreaterThan(0);
      for (const artifact of results) {
        expect(typeof artifact.denseText).toBe("string");
        expect(artifact.denseText.length).toBeGreaterThan(0);
        expect(typeof artifact.sparseText).toBe("string");
        expect(artifact.denseTextHash).toMatch(/^[0-9a-f]{16}$/);
        expect(artifact.sourceFile).toBe("src/app.py");
        expect(artifact.commitHash).toBe("abc123");
        expect(artifact.metadata.sourceFormat).toBe("code");
      }
    });

    it("denseText includes breadcrumb from section signature", async () => {
      const chunker = createTestChunker();
      const results = await chunker.chunk("src/app.py", "abc123");
      const combined = results.map((r) => r.denseText).join("\n");
      expect(combined).toContain("greet");
    });

    it("sparseText does not contain breadcrumb prefix", async () => {
      const chunker = createTestChunker();
      const results = await chunker.chunk("src/app.py", "abc123");
      for (const r of results) {
        expect(r.sparseText).not.toMatch(/›/);
      }
    });

    it("native binding is loaded lazily (only on first chunk call)", async () => {
      let callCount = 0;
      const testChunker = createNativeChunker<LangChunkerOptions>({
        name: "@vivantel/virage-chunker-ce-lang",
        version: "0.1.0",
        sourceFormat: "code",
        patterns: ["**/*.py"],
        loadBinding: () => {
          callCount++;
          return {};
        },
        callNative: (_b, _filePath) => mockResult,
      })();

      expect(callCount).toBe(0);
      await testChunker.chunk("a.py", "h1");
      expect(callCount).toBe(1);
      await testChunker.chunk("b.py", "h2");
      expect(callCount).toBe(1);
    });
  });
});
