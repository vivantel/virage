import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { GitTracker } from "./git-tracker.js";
import { FileChunker } from "../interfaces/index.js";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { execSync } from "child_process";

describe("GitTracker", () => {
  let testDir: string;
  let originalCwd: string;

  const mockChunker: FileChunker = {
    name: "test",
    patterns: ["**/*.txt", "**/*.yaml", "**/*.json"],
    chunk: vi.fn().mockResolvedValue([]),
  };

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), "git-test-"));
    originalCwd = process.cwd();
    process.chdir(testDir);

    mkdirSync(join(testDir, "src", "events"), { recursive: true });

    writeFileSync(join(testDir, "test.txt"), "test content");
    writeFileSync(
      join(testDir, "src", "events", "booking.yaml"),
      "event_type: BookingCreated",
    );
    writeFileSync(join(testDir, "config.json"), '{"key": "value"}');

    execSync("git init", { stdio: "ignore" });
    execSync('git config user.email "test@example.com"', { stdio: "ignore" });
    execSync('git config user.name "Test"', { stdio: "ignore" });
    execSync("git add .", { stdio: "ignore" });
    execSync('git commit -m "initial"', { stdio: "ignore" });
  });

  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(testDir, { recursive: true, force: true });
  });

  it("should be instantiable", () => {
    const tracker = new GitTracker([mockChunker]);
    expect(tracker).toBeInstanceOf(GitTracker);
  });

  it("should getAllTrackedFiles", async () => {
    const tracker = new GitTracker([mockChunker]);
    const files = await tracker.getAllTrackedFiles();

    expect(files.length).toBeGreaterThan(0);
    expect(files.some((f) => f.includes("test.txt"))).toBe(true);
  });

  it("should getCurrentState", async () => {
    const tracker = new GitTracker([mockChunker]);
    const state = await tracker.getCurrentState();

    expect(state.size).toBeGreaterThan(0);
  });
});
