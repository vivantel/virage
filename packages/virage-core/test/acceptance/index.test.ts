import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { existsSync, statSync, unlinkSync, readFileSync } from "fs";
import { join } from "path";
import {
  CLI,
  setupEnv,
  teardownEnv,
  runCLI,
  type TestEnv,
} from "./helpers/setup.js";

let env: TestEnv;

const CONFIG = "virage.config.json";
const STORE = "rag-test/vector-store.json";

function abs(rel: string) {
  return join(env.cloneDir, rel);
}
function readJSON<T>(rel: string): T {
  return JSON.parse(readFileSync(abs(rel), "utf8")) as T;
}
function cli(...flags: string[]) {
  return runCLI(env.cloneDir, "index", "--config", CONFIG, "-v", ...flags);
}

describe("virage index — pipeline acceptance tests", () => {
  beforeAll(() => {
    if (!existsSync(CLI))
      throw new Error(`CLI not found at ${CLI}. Run "npm run build" first.`);
    env = setupEnv();
  });

  afterAll(() => teardownEnv(env));

  it("1: first run — uploads documents to vector store", () => {
    const result = cli();
    expect(result.status, result.stderr).toBe(0);

    const store = readJSON<unknown[]>(STORE);
    expect(store.length).toBeGreaterThan(50);
  });

  it("2: incremental run — no-op when nothing changed", () => {
    const mtimeBefore = statSync(abs(STORE)).mtimeMs;
    const result = cli();
    expect(result.status).toBe(0);
    expect(result.stdout + result.stderr).toContain("No changes detected");
    expect(statSync(abs(STORE)).mtimeMs).toBe(mtimeBefore);
  });

  it("3: --force — re-embeds everything, store remains populated", () => {
    const result = cli("--force");
    expect(result.status, result.stderr).toBe(0);
    const store = readJSON<unknown[]>(STORE);
    expect(store.length).toBeGreaterThan(0);
  });

  it("4: --force --no-upload — embeddings written, store not recreated", () => {
    if (existsSync(abs(STORE))) unlinkSync(abs(STORE));
    const result = cli("--force", "--no-upload");
    expect(result.status, result.stderr).toBe(0);
    expect(existsSync(abs(STORE))).toBe(false);
  });

  it("5: --force --dry-run — previews upload count, store stays absent", () => {
    const result = cli("--force", "--dry-run");
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout + result.stderr).toContain("Would upload");
    expect(existsSync(abs(STORE))).toBe(false);
  });
});
