import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { runCLI } from "./helpers/setup.js";
import { writeChunks } from "./helpers/fixtures.js";

let dir: string;

describe("virage chunks report", () => {
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "rag-chunks-"));
    writeChunks(dir, 20);
  });

  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("exits 0 and shows cohesion stats", () => {
    const result = runCLI(
      dir,
      "chunks",
      "report",
      "--file",
      join(dir, "rag-test", "chunks.json"),
    );
    expect(result.status, result.stderr).toBe(0);
    const out = result.stdout + result.stderr;
    expect(out).toContain("Chunk Cohesion Report");
    expect(out).toContain("Cohesion");
  });

  it("exits non-zero for a missing chunks file", () => {
    const result = runCLI(
      dir,
      "chunks",
      "report",
      "--file",
      join(dir, "nonexistent.json"),
    );
    expect(result.status).not.toBe(0);
  });
});
