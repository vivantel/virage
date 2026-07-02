import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  readFileSync,
  existsSync,
} from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { execSync } from "child_process";
import { CLI, runCLI } from "./helpers/setup.js";

const CACHE_DIR =
  process.env.FASTEMBED_CACHE_DIR ??
  join(tmpdir(), "virage-fastembed-test-cache");
const STORE = "rag-test/vector-store.json";
const CONFIG = "virage.config.json";

let repoDir: string;

function abs(rel: string) {
  return join(repoDir, rel);
}

function readStore(): unknown[] {
  return JSON.parse(readFileSync(abs(STORE), "utf8")) as unknown[];
}

function cli(...flags: string[]) {
  return runCLI(repoDir, "index", "--config", CONFIG, "-v", ...flags);
}

function gitCommit(message: string) {
  execSync("git add -A", { cwd: repoDir, stdio: "pipe" });
  execSync(`git commit -m "${message}"`, { cwd: repoDir, stdio: "pipe" });
}

describe("virage index — caching and zero-chunk acceptance tests", () => {
  beforeAll(() => {
    if (!existsSync(CLI))
      throw new Error(`CLI not found at ${CLI}. Run "npm run build" first.`);

    repoDir = mkdtempSync(join(tmpdir(), "virage-caching-"));

    execSync("git init", { cwd: repoDir, stdio: "pipe" });
    execSync("git config user.email test@virage.test", {
      cwd: repoDir,
      stdio: "pipe",
    });
    execSync("git config user.name Test", { cwd: repoDir, stdio: "pipe" });

    writeFileSync(
      abs("docs.md"),
      [
        "# Introduction",
        "",
        "Introductory content with sufficient text to be indexed as a meaningful chunk.",
        "",
        "## Section One",
        "",
        "Content for section one. This section contains enough text to form a real chunk.",
        "",
        "## Section Two",
        "",
        "Content for section two. This section also contains enough text to form a real chunk.",
      ].join("\n"),
    );

    gitCommit("initial");

    writeFileSync(
      abs(CONFIG),
      JSON.stringify(
        {
          chunkers: [{ patterns: ["**/*.md"], strategy: "markdownHeaders" }],
          embedder: {
            package: "@vivantel/virage-embedder-fastembed",
            config: {
              model: "fast-bge-small-en-v1.5",
              dimensions: 384,
              cacheDir: CACHE_DIR,
            },
          },
          vectorStore: {
            package: "@vivantel/virage-store-test",
            config: { path: `./${STORE}` },
          },
        },
        null,
        2,
      ),
    );
  });

  afterAll(() => {
    rmSync(repoDir, { recursive: true, force: true });
  });

  it("6: caching — unchanged chunks skipped when a file is partially modified", () => {
    // Run 1: embed all chunks into the store
    const r1 = cli();
    expect(r1.status, r1.stderr).toBe(0);
    const countAfterRun1 = readStore().length;
    expect(countAfterRun1).toBeGreaterThan(0);

    // Append a new section → 1 new chunk, existing chunks unchanged
    writeFileSync(
      abs("docs.md"),
      readFileSync(abs("docs.md"), "utf8") +
        [
          "",
          "## Section Three",
          "",
          "New content for section three. This additional section adds exactly one more chunk.",
        ].join("\n"),
    );
    gitCommit("add section three");

    // Run 2: only the new chunk should be embedded; old chunks skipped via existingHashes
    const r2 = cli();
    expect(r2.status, r2.stderr).toBe(0);
    const combined = r2.stdout + r2.stderr;
    expect(combined).not.toContain("No changes detected");
    expect(combined).toContain("skipped");
    expect(combined).toContain("cached");

    // Store grew by exactly 1 (the new chunk)
    expect(readStore().length).toBe(countAfterRun1 + 1);
  });

  it("7: zero-chunk — empty file is not reprocessed on second run", () => {
    // Create an empty markdown file — chunker returns [] for it
    writeFileSync(abs("empty.md"), "");
    gitCommit("add empty file");

    const r1 = cli();
    expect(r1.status, r1.stderr).toBe(0);
    const storeCountAfterR1 = readStore().length;

    // Second run: empty.md should be recognised as unchanged via db.getFileStates()
    const r2 = cli();
    expect(r2.status, r2.stderr).toBe(0);
    expect(r2.stdout + r2.stderr).toContain("No changes detected");
    expect(readStore().length).toBe(storeCountAfterR1);
  });

  it("8: consecutive run with no changes — second run is a true no-op", () => {
    // Repo already has docs.md (4 sections) + empty.md, all committed and indexed.
    // A plain re-run with no disk/git changes must report "No changes detected".
    const r1 = cli();
    expect(r1.status, r1.stderr).toBe(0);
    const storeBefore = readStore().length;

    const r2 = cli();
    expect(r2.status, r2.stderr).toBe(0);
    expect(r2.stdout + r2.stderr).toContain("No changes detected");
    expect(readStore().length).toBe(storeBefore);
  });
});
