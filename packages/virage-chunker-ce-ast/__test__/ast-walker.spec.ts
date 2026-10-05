import { describe, it, expect } from "vitest";
import type { DocNode, ArtifactSet } from "../src/types.js";
import { walkDocNode } from "../src/ast-walker.js";
import { walkToChunks } from "../src/chunker.js";
import { extractOutline } from "../src/outline.js";

function para(text: string, byteStart = 0): DocNode {
  return {
    type: "paragraph",
    text,
    attrs: { byteStart, byteEnd: byteStart + text.length },
  };
}

function code(text: string, byteStart = 0, lang = "python"): DocNode {
  return {
    type: "code",
    text,
    attrs: { byteStart, byteEnd: byteStart + text.length, codeLanguage: lang },
  };
}

function heading(text: string, level: 1 | 2 | 3 = 1, byteStart = 0): DocNode {
  return {
    type: "heading",
    text,
    attrs: { byteStart, byteEnd: byteStart + text.length, headingLevel: level },
  };
}

function doc(...children: DocNode[]): DocNode {
  return {
    type: "document",
    children,
    attrs: {
      byteStart: 0,
      byteEnd: children.reduce((s, n) => Math.max(s, n.attrs.byteEnd), 0),
    },
  };
}

describe("walkDocNode", () => {
  it("returns empty array for document with no text", () => {
    expect(walkDocNode(doc())).toEqual([]);
  });

  it("collects leaf paragraph text", () => {
    const segs = walkDocNode(doc(para("hello")));
    expect(segs).toHaveLength(1);
    expect(segs[0]!.text).toBe("hello");
  });

  it("sets nodeType on each segment", () => {
    const segs = walkDocNode(doc(para("p"), code("c")));
    expect(segs[0]!.nodeType).toBe("paragraph");
    expect(segs[1]!.nodeType).toBe("code");
  });

  it("does not emit headings as text segments", () => {
    const segs = walkDocNode(doc(heading("Title"), para("body")));
    expect(segs).toHaveLength(1);
    expect(segs[0]!.text).toBe("body");
  });

  it("sets breadcrumb from ancestor heading", () => {
    const segs = walkDocNode(doc(heading("Intro"), para("first paragraph")));
    expect(segs[0]!.breadcrumb).toEqual(["Intro"]);
  });

  it("updates breadcrumb at heading level boundaries", () => {
    const tree = doc(
      heading("Chapter 1", 1),
      heading("Section 1.1", 2),
      para("paragraph in 1.1"),
      heading("Section 1.2", 2),
      para("paragraph in 1.2"),
    );
    const segs = walkDocNode(tree);
    expect(segs[0]!.breadcrumb).toEqual(["Chapter 1", "Section 1.1"]);
    expect(segs[1]!.breadcrumb).toEqual(["Chapter 1", "Section 1.2"]);
  });
});

describe("extractOutline", () => {
  it("returns h1 titles from direct children", () => {
    const root = doc(heading("Alpha", 1), heading("Beta", 1), para("text"));
    expect(extractOutline(root)).toEqual(["Alpha", "Beta"]);
  });

  it("ignores non-h1 headings at top level", () => {
    expect(extractOutline(doc(heading("Sub", 2)))).toEqual([]);
  });
});

describe("walkToChunks", () => {
  const opts = {
    sourceFile: "test.pdf",
    sourceFormat: "pdf",
    commitHash: "abc123",
    sparseTextGeneratorId: "test@0.1.0:sparse:{}",
    metadataGeneratorId: "test@0.1.0:meta:{}",
    maxTokens: 20,
    minTokens: 5,
  };

  function checkArtifact(a: ArtifactSet) {
    expect(typeof a.denseText).toBe("string");
    expect(a.denseText.length).toBeGreaterThan(0);
    expect(typeof a.sparseText).toBe("string");
    expect(typeof a.denseTextHash).toBe("string");
    expect(a.denseTextHash.length).toBe(16);
    expect(typeof a.sparseTextGeneratorId).toBe("string");
    expect(typeof a.metadataGeneratorId).toBe("string");
    const m = a.metadata;
    expect(typeof m.sourceFile).toBe("string");
    expect(typeof m.byteStart).toBe("number");
    expect(typeof m.byteEnd).toBe("number");
    expect(Array.isArray(m.breadcrumb)).toBe(true);
    expect(typeof m.chunkIndex).toBe("number");
    expect(typeof m.totalChunks).toBe("number");
    expect(typeof m.estimatedTokens).toBe("number");
  }

  it("returns empty array for empty document", () => {
    expect(walkToChunks(doc(), opts)).toEqual([]);
  });

  it("produces at least one ArtifactSet for non-empty content", () => {
    const artifacts = walkToChunks(doc(para("a".repeat(80))), opts);
    expect(artifacts.length).toBeGreaterThanOrEqual(1);
  });

  it("populates all required fields on every ArtifactSet", () => {
    const artifacts = walkToChunks(doc(para("hello world")), opts);
    expect(artifacts.length).toBeGreaterThan(0);
    for (const a of artifacts) checkArtifact(a);
  });

  it("sets chunkIndex sequentially from 0", () => {
    const bigDoc = doc(
      ...Array.from({ length: 10 }, (_, i) => para("word ".repeat(6), i * 30)),
    );
    const artifacts = walkToChunks(bigDoc, { ...opts, maxTokens: 5 });
    artifacts.forEach((a, i) => {
      expect(a.metadata.chunkIndex).toBe(i);
      expect(a.metadata.totalChunks).toBe(artifacts.length);
    });
  });

  it("breadcrumb tracks heading context", () => {
    const tree = doc(heading("Chapter", 1, 0), para("content", 10));
    const artifacts = walkToChunks(tree, opts);
    expect(artifacts[0]!.metadata.breadcrumb).toEqual(["Chapter"]);
    expect(artifacts[0]!.metadata.sectionTitle).toBe("Chapter");
  });

  it("denseText includes breadcrumb prefix", () => {
    const tree = doc(heading("Intro", 1, 0), para("This is the intro text.", 10));
    const artifacts = walkToChunks(tree, opts);
    expect(artifacts[0]!.denseText).toContain("Intro");
  });

  it("assigns siblingPrev and siblingNext across windows", () => {
    const bigDoc = doc(
      ...Array.from({ length: 10 }, (_, i) => para("word ".repeat(6), i * 30)),
    );
    const artifacts = walkToChunks(bigDoc, { ...opts, maxTokens: 5 });
    expect(artifacts.length).toBeGreaterThan(1);
    expect(artifacts[0]!.metadata.siblingPrev).toBeUndefined();
    expect(artifacts[0]!.metadata.siblingNext).toBeDefined();
    expect(
      artifacts[artifacts.length - 1]!.metadata.siblingPrev,
    ).toBeDefined();
    expect(
      artifacts[artifacts.length - 1]!.metadata.siblingNext,
    ).toBeUndefined();
  });

  it("denseText includes breadcrumb headings and body content", () => {
    const tree = doc(
      heading("Intro", 1, 0),
      heading("Config", 2, 10),
      para("configure it here", 20),
    );
    const artifacts = walkToChunks(tree, opts);
    expect(artifacts[0]!.denseText).toContain("Intro");
    expect(artifacts[0]!.denseText).toContain("configure it here");
  });

  it("flushes a new window when entering a different section", () => {
    const tree = doc(
      heading("Section A", 1, 0),
      para("aaa bbb ccc", 10),
      heading("Section B", 1, 25),
      para("ddd eee fff", 35),
    );
    const artifacts = walkToChunks(tree, opts);
    expect(artifacts.length).toBe(2);
    expect(artifacts[0]!.metadata.breadcrumb).toEqual(["Section A"]);
    expect(artifacts[1]!.metadata.breadcrumb).toEqual(["Section B"]);
  });

  it("does not merge trailing small window across section boundaries", () => {
    const tree = doc(
      heading("Section A", 1, 0),
      para("word ".repeat(6), 10),
      heading("Section B", 1, 50),
      para("x", 60),
    );
    const artifacts = walkToChunks(tree, opts);
    const sectionBChunk = artifacts.find(
      (a) => a.metadata.breadcrumb[0] === "Section B",
    );
    expect(sectionBChunk).toBeDefined();
    expect(sectionBChunk!.denseText).not.toContain("word");
  });

  describe("overlap", () => {
    it("produces more windows with overlap > 0 than without", () => {
      const bigDoc = doc(
        ...Array.from({ length: 12 }, (_, i) => para("word ".repeat(4), i * 20)),
      );
      const noOverlap = walkToChunks(bigDoc, { ...opts, maxTokens: 15, overlap: 0 });
      const withOverlap = walkToChunks(bigDoc, {
        ...opts,
        maxTokens: 15,
        overlap: 0.5,
      });
      expect(withOverlap.length).toBeGreaterThan(noOverlap.length);
    });

    it("overlap=0 is the same as no overlap option", () => {
      const d = doc(
        ...Array.from({ length: 6 }, (_, i) => para("word ".repeat(5), i * 25)),
      );
      const a = walkToChunks(d, { ...opts, maxTokens: 10 });
      const b = walkToChunks(d, { ...opts, maxTokens: 10, overlap: 0 });
      expect(a.length).toBe(b.length);
    });
  });

  describe("adaptiveSize", () => {
    it("code segments produce smaller windows than prose segments at same maxTokens", () => {
      const prosePara = para("prose word ".repeat(10), 0);
      const codePara = code("code word ".repeat(10), 200);
      const proseArtifacts = walkToChunks(doc(prosePara), {
        ...opts,
        maxTokens: 50,
        adaptiveSize: true,
      });
      const codeArtifacts = walkToChunks(doc(codePara), {
        ...opts,
        maxTokens: 50,
        adaptiveSize: true,
      });
      const proseAvg =
        proseArtifacts.reduce((s, a) => s + a.metadata.estimatedTokens!, 0) /
        proseArtifacts.length;
      const codeAvg =
        codeArtifacts.reduce((s, a) => s + a.metadata.estimatedTokens!, 0) /
        codeArtifacts.length;
      expect(codeAvg).toBeLessThanOrEqual(proseAvg);
    });
  });

  describe("recursive", () => {
    it("preserves all content of an oversized segment when recursive=true", () => {
      const longText = "word ".repeat(200);
      const artifacts = walkToChunks(doc(para(longText, 0)), {
        ...opts,
        maxTokens: 20,
        recursive: true,
      });
      const reconstructed = artifacts.map((a) => a.sparseText).join("");
      expect(reconstructed.replace(/\s+/g, " ").trim().length).toBeGreaterThan(
        longText.length * 0.9,
      );
    });

    it("non-recursive hard-cut loses content beyond maxTokens", () => {
      const longText = "x".repeat(500);
      const artifacts = walkToChunks(doc(para(longText, 0)), {
        ...opts,
        maxTokens: 20,
        recursive: false,
      });
      expect(artifacts.length).toBe(1);
      expect(artifacts[0]!.sparseText.length).toBeLessThan(longText.length);
      expect(artifacts[0]!.metadata.truncated).toBe(true);
    });
  });
});
