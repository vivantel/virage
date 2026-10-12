import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import {
  buildDeclaration,
  declarationPath,
  isConformanceMode,
  policyPath,
  writeDeclaration,
  PRE_INDEX_SECRET_SCAN,
  RETRIEVAL_CONTRACT_VERSION,
} from "./retrieval-contract.js";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "virage-retrieval-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function writePolicy(): Promise<void> {
  await mkdir(join(dir, ".go-getter", "retrieval"), { recursive: true });
  await writeFile(policyPath(dir), "{}");
}

describe("isConformanceMode", () => {
  it("is off with no config and no policy file", async () => {
    expect(await isConformanceMode(dir)).toBe(false);
  });

  it("is on when the policy file exists and the config says nothing", async () => {
    await writePolicy();
    expect(await isConformanceMode(dir)).toBe(true);
  });

  it("is on with an explicit true flag and no policy file", async () => {
    await writeFile(
      join(dir, "virage.config.json"),
      JSON.stringify({ retrieval: { conformance: true } }),
    );
    expect(await isConformanceMode(dir)).toBe(true);
  });

  it("explicit false wins over a policy file", async () => {
    await writePolicy();
    await writeFile(
      join(dir, "virage.config.json"),
      JSON.stringify({ retrieval: { conformance: false } }),
    );
    expect(await isConformanceMode(dir)).toBe(false);
  });

  it("falls back to the policy file when the config is unparseable", async () => {
    await writePolicy();
    await writeFile(join(dir, "virage.config.json"), "{ not json");
    expect(await isConformanceMode(dir)).toBe(true);
  });
});

describe("declaration", () => {
  it("has exactly the contract fields", () => {
    expect(buildDeclaration("1.2.3")).toEqual({
      contractVersion: RETRIEVAL_CONTRACT_VERSION,
      tool: "virage",
      toolVersion: "1.2.3",
      preIndexSecretScan: PRE_INDEX_SECRET_SCAN,
      registersHostConfig: false,
    });
  });

  it("is written under .go-getter/retrieval and is idempotent", async () => {
    expect(await writeDeclaration(dir, "1.0.0")).toBe(true);
    expect(await writeDeclaration(dir, "1.0.0")).toBe(false);
    expect(await writeDeclaration(dir, "1.0.1")).toBe(true);
    const parsed = JSON.parse(await readFile(declarationPath(dir), "utf-8"));
    expect(parsed.toolVersion).toBe("1.0.1");
    expect(parsed.registersHostConfig).toBe(false);
  });
});
