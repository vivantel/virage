import { describe, it, expect } from "vitest";
import { computeChunkQualityMetrics } from "./quality-metrics.js";
import type { Chunk } from "../../interfaces/index.js";

function makeChunk(content: string): Chunk {
  return {
    content,
    metadata: {},
    sourceFile: "test.txt",
    commitHash: "abc",
  };
}

describe("computeChunkQualityMetrics", () => {
  describe("empty input", () => {
    it("returns all-zero metrics for empty array", () => {
      const m = computeChunkQualityMetrics([]);
      expect(m.avgChunkSize).toBe(0);
      expect(m.stdDevChunkSize).toBe(0);
      expect(m.semanticCoherence).toBe(0);
      expect(m.informationDensity).toBe(0);
    });
  });

  describe("avgChunkSize and stdDevChunkSize", () => {
    it("single chunk → avgChunkSize equals content length, stdDev is 0", () => {
      const m = computeChunkQualityMetrics([makeChunk("Hello world.")]);
      expect(m.avgChunkSize).toBe(12);
      expect(m.stdDevChunkSize).toBe(0);
    });

    it("two equal-sized chunks → stdDev is 0", () => {
      const m = computeChunkQualityMetrics([
        makeChunk("Hello."), // 6
        makeChunk("World."), // 6
      ]);
      expect(m.avgChunkSize).toBe(6);
      expect(m.stdDevChunkSize).toBe(0);
    });

    it("two unequal chunks → correct mean and population stdDev", () => {
      // 22 chars and 11 chars
      const m = computeChunkQualityMetrics([
        makeChunk("the cat sat on the mat."), // 23
        makeChunk("hello world"), // 11
      ]);
      const avg = (23 + 11) / 2; // 17
      const variance = ((23 - avg) ** 2 + (11 - avg) ** 2) / 2; // 36
      expect(m.avgChunkSize).toBeCloseTo(avg, 5);
      expect(m.stdDevChunkSize).toBeCloseTo(Math.sqrt(variance), 5);
    });
  });

  describe("semanticCoherence", () => {
    it("is 1 when all chunks end with sentence terminators", () => {
      const m = computeChunkQualityMetrics([
        makeChunk("Done."),
        makeChunk("Really!"),
        makeChunk("Why?"),
        makeChunk("Newline\n"),
      ]);
      expect(m.semanticCoherence).toBe(1);
    });

    it("is 0 when no chunk ends with a terminator", () => {
      const m = computeChunkQualityMetrics([
        makeChunk("no terminator here"),
        makeChunk("also no terminator"),
      ]);
      expect(m.semanticCoherence).toBe(0);
    });

    it("is fractional for a mix", () => {
      const m = computeChunkQualityMetrics([
        makeChunk("Ends with period."),
        makeChunk("no period here"),
      ]);
      expect(m.semanticCoherence).toBeCloseTo(0.5, 5);
    });

    it("trailing whitespace after terminator still counts", () => {
      const m = computeChunkQualityMetrics([makeChunk("Hello.  ")]);
      expect(m.semanticCoherence).toBe(1);
    });
  });

  describe("informationDensity", () => {
    it("is 1 for a chunk with all unique tokens", () => {
      // "cat dog bird" → 3 unique / 3 total = 1
      const m = computeChunkQualityMetrics([makeChunk("cat dog bird")]);
      expect(m.informationDensity).toBeCloseTo(1, 5);
    });

    it("is less than 1 for repeated tokens", () => {
      // "the cat the cat" → tokens: the, cat, the, cat → 2 unique / 4 total = 0.5
      const m = computeChunkQualityMetrics([makeChunk("the cat the cat")]);
      expect(m.informationDensity).toBeCloseTo(0.5, 5);
    });

    it("computes average density across multiple chunks", () => {
      // chunk1: "cat dog" → 2/2 = 1.0
      // chunk2: "the the the" → 1/3 ≈ 0.333
      // average: (1.0 + 0.333) / 2 ≈ 0.667
      const m = computeChunkQualityMetrics([
        makeChunk("cat dog"),
        makeChunk("the the the"),
      ]);
      expect(m.informationDensity).toBeCloseTo((1 + 1 / 3) / 2, 3);
    });

    it("is 0 for a chunk with no tokens (only punctuation/whitespace)", () => {
      const m = computeChunkQualityMetrics([makeChunk("... --- !!!")]);
      expect(m.informationDensity).toBe(0);
    });

    it("token comparison is case-insensitive", () => {
      // "The the THE" → all lower to "the" → 1 unique / 3 total ≈ 0.333
      const m = computeChunkQualityMetrics([makeChunk("The the THE")]);
      expect(m.informationDensity).toBeCloseTo(1 / 3, 3);
    });
  });
});
