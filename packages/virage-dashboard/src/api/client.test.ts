import { describe, it, expect } from "vitest";
import { api } from "./client.js";

describe("api client", () => {
  it("exports all dashboard API methods as functions", () => {
    const expected = [
      "status", "chunks", "anomalies", "projects",
      "addProject", "switchProject", "chunksAll", "deleteChunksFile",
      "deleteChunksAll", "search", "experiments", "experiment",
      "deleteExperiment", "compareExperiments",
    ];
    for (const method of expected) {
      expect(typeof (api as Record<string, unknown>)[method], method).toBe("function");
    }
  });
});
