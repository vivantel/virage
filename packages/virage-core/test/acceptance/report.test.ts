import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { runCLI } from "./helpers/setup.js";
import { writePipelineRunToDb } from "./helpers/fixtures.js";

let dir: string;

describe("virage report", () => {
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "rag-report-"));
    writePipelineRunToDb(dir);
  });

  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("exits 0 and displays observability report", () => {
    const result = runCLI(dir, "report");
    expect(result.status, result.stderr).toBe(0);
    const out = result.stdout + result.stderr;
    expect(out).toContain("Observability Report");
  });

  it("exits 0 gracefully when no pipeline runs exist", () => {
    const emptyDir = mkdtempSync(join(tmpdir(), "rag-report-empty-"));
    try {
      const result = runCLI(emptyDir, "report");
      expect(result.status).toBe(0);
      expect(result.stdout + result.stderr).toContain("No pipeline runs");
    } finally {
      rmSync(emptyDir, { recursive: true, force: true });
    }
  });
});
