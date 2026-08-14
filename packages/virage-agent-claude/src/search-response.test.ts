import { describe, it, expect } from "vitest";
import {
  transformSearchResults,
  DEFAULT_SEARCH_FIELDS,
  FULL_SEARCH_FIELDS,
  type RawSearchResult,
} from "./search-response.js";

function makeResult(overrides: Partial<RawSearchResult> = {}): RawSearchResult {
  return {
    rank: 1,
    similarity: 0.81,
    sourceFile: "docs/example.md",
    denseText: "short chunk text",
    metadata: {
      chunkIndex: 0,
      totalChunks: 3,
      sourceFormat: "md",
      estimatedTokens: 42,
      breadcrumb: [],
    },
    ...overrides,
  };
}

describe("transformSearchResults", () => {
  it("defaults to exactly the 4 trimmed fields, flat (no nested metadata)", () => {
    // lineStart present so citation actually resolves - a chunk with no
    // location data at all legitimately omits citation (see the
    // "leaves citation unset" test below), so this fixture needs it to make
    // the "exactly these 4 keys" assertion meaningful.
    const [out] = transformSearchResults([
      makeResult({ metadata: { lineStart: 7 } }),
    ]);
    expect(Object.keys(out).sort()).toEqual([...DEFAULT_SEARCH_FIELDS].sort());
    expect(out.metadata).toBeUndefined();
    expect(out.sourceFile).toBe("docs/example.md");
    expect(out.similarity).toBe(0.81);
  });

  it("returns exactly the requested subset when fields is provided", () => {
    const [out] = transformSearchResults(
      [makeResult()],
      ["chunkIndex", "totalChunks"],
    );
    expect(Object.keys(out).sort()).toEqual(["chunkIndex", "totalChunks"]);
    expect(out.chunkIndex).toBe(0);
    expect(out.totalChunks).toBe(3);
  });

  it("truncates denseText past the char budget in default mode, with a marker", () => {
    const longText = "x".repeat(1000);
    const [out] = transformSearchResults([makeResult({ denseText: longText })]);
    const text = out.denseText as string;
    expect(text.length).toBeLessThan(longText.length);
    expect(text).toContain("(truncated, 1000 chars total");
  });

  it("does not truncate denseText when the caller requests it explicitly via fields", () => {
    const longText = "x".repeat(1000);
    const [out] = transformSearchResults(
      [makeResult({ denseText: longText })],
      ["denseText"],
    );
    expect(out.denseText).toBe(longText);
  });

  it("does not add a truncation marker when text is already under the budget", () => {
    const [out] = transformSearchResults([makeResult({ denseText: "short" })]);
    expect(out.denseText).toBe("short");
  });

  it("derives citation from metadata.lineStart when no chunker-owned citation is set", () => {
    const [out] = transformSearchResults([
      makeResult({ metadata: { lineStart: 42 } }),
    ]);
    expect(out.citation).toBe("line 42");
  });

  it("prefers a chunker-owned citation over the lineStart fallback", () => {
    const [out] = transformSearchResults([
      makeResult({ metadata: { lineStart: 42, citation: "Sheet1!B4" } }),
    ]);
    expect(out.citation).toBe("Sheet1!B4");
  });

  it("leaves citation unset when neither citation nor lineStart is present", () => {
    const [out] = transformSearchResults([makeResult({ metadata: {} })]);
    expect(out.citation).toBeUndefined();
  });

  it("full field list covers every requested field without collision", () => {
    const [out] = transformSearchResults(
      [
        makeResult({
          metadata: {
            chunkIndex: 0,
            totalChunks: 3,
            siblingIds: ["a", "b"],
            siblingPrev: "a",
            siblingNext: "b",
            sourceFormat: "md",
            strategy: "window",
            estimatedTokens: 42,
            breadcrumb: ["Intro"],
            byteStart: 0,
            byteEnd: 100,
            citation: "line 7",
          },
        }),
      ],
      [...FULL_SEARCH_FIELDS],
    );
    expect(Object.keys(out).sort()).toEqual([...FULL_SEARCH_FIELDS].sort());
  });

  it("omits a requested field entirely when the underlying metadata doesn't have it", () => {
    // e.g. sheetName-only fields on a non-xlsx chunk, or lineStart absent for
    // a chunker that hasn't been backfilled yet (PDF/DOCX/LaTeX as of this
    // commit) - the field should just not appear, not be null/undefined-filled.
    const [out] = transformSearchResults([makeResult()], ["byteStart"]);
    expect("byteStart" in out).toBe(false);
  });
});
