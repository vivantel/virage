import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import {
  checkEmbedder,
  embedderKind,
  filterByPolicy,
  gitignoreToGlobs,
  loadRetrievalPolicy,
  parsePolicy,
  policyMatcher,
} from "./retrieval-policy.js";
import { policyPath } from "./retrieval-contract.js";

function policyJson(over: Record<string, unknown> = {}): string {
  return JSON.stringify({
    contractVersion: 0,
    ignore: ["**/.env", "secrets/**"],
    embedders: ["local"],
    dataClass: "internal",
    ...over,
  });
}

describe("parsePolicy", () => {
  it("parses a valid policy", () => {
    const p = parsePolicy(policyJson());
    expect(p.allowLocal).toBe(true);
    expect(p.allowHosted).toBe(false);
    expect(p.dataClass).toBe("internal");
    expect(p.ignoreGlobs).toContain("**/.env");
  });

  it("ignores unknown fields", () => {
    expect(() => parsePolicy(policyJson({ future: 1 }))).not.toThrow();
  });

  it.each(["contractVersion", "ignore", "embedders", "dataClass"])(
    "refuses a missing %s",
    (field) => {
      const o = JSON.parse(policyJson()) as Record<string, unknown>;
      delete o[field];
      expect(() => parsePolicy(JSON.stringify(o))).toThrow(
        new RegExp(`field \`${field}\``),
      );
    },
  );

  it("refuses an unknown contractVersion", () => {
    expect(() => parsePolicy(policyJson({ contractVersion: 1 }))).toThrow(
      /unsupported contractVersion/,
    );
    expect(() => parsePolicy(policyJson({ contractVersion: "0" }))).toThrow();
  });

  it("refuses malformed fields and non-JSON without echoing content", () => {
    expect(() => parsePolicy(policyJson({ ignore: [1] }))).toThrow();
    expect(() => parsePolicy(policyJson({ dataClass: "nope" }))).toThrow();
    expect(() => parsePolicy("not json")).toThrow(/unreadable/);
    try {
      parsePolicy(policyJson({ ignore: ["visible-marker", 1] }));
    } catch (e) {
      expect(String(e)).not.toContain("visible-marker");
    }
  });
});

describe("embedder check", () => {
  it("classifies local and hosted packages", () => {
    expect(embedderKind("@vivantel/virage-embedder-onnx")).toBe("local");
    expect(embedderKind("@vivantel/virage-embedder-openai")).toBe("hosted");
    expect(embedderKind("some-vendor-embedder")).toBe("hosted");
  });

  it("refuses a hosted embedder unless the policy lists hosted", () => {
    const localOnly = parsePolicy(policyJson());
    expect(() =>
      checkEmbedder(localOnly, "@vivantel/virage-embedder-fastembed"),
    ).not.toThrow();
    expect(() =>
      checkEmbedder(localOnly, "@vivantel/virage-embedder-openai"),
    ).toThrow(/hosted embedder is not allowed/);
    const both = parsePolicy(policyJson({ embedders: ["local", "hosted"] }));
    expect(() =>
      checkEmbedder(both, "@vivantel/virage-embedder-openai"),
    ).not.toThrow();
  });
});

describe("gitignoreToGlobs / matcher", () => {
  it("converts gitignore lines", () => {
    expect(gitignoreToGlobs(".env")).toEqual(["**/.env", "**/.env/**"]);
    expect(gitignoreToGlobs("secrets/")).toEqual(["**/secrets/**"]);
    expect(gitignoreToGlobs("/build")).toEqual(["build", "build/**"]);
    expect(gitignoreToGlobs("# c")).toEqual([]);
    expect(gitignoreToGlobs("!keep")).toEqual([]);
  });

  it("matches files, directories and depth", () => {
    const m = policyMatcher(
      parsePolicy(policyJson({ ignore: ["**/.env", "secrets/**", "*.pem"] })),
    );
    expect(m(".env")).toBe(true);
    expect(m("a/b/.env")).toBe(true);
    expect(m("./secrets/deep/key.txt")).toBe(true);
    expect(m("certs/server.pem")).toBe(true);
    expect(m("secrets\\key.txt")).toBe(true);
    expect(m("src/main.ts")).toBe(false);
    expect(m("docs/secrets-guide.md")).toBe(false);
  });

  it("filters results, dropping sourceless ones", () => {
    const p = parsePolicy(policyJson());
    const out = filterByPolicy(
      [{ sourceFile: "src/a.ts" }, { sourceFile: "secrets/k" }, {}],
      p,
    );
    expect(out).toEqual([{ sourceFile: "src/a.ts" }]);
    expect(filterByPolicy([{}], null)).toEqual([{}]);
  });
});

describe("loadRetrievalPolicy", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "virage-policy-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function writePolicy(content: string): Promise<void> {
    await mkdir(join(dir, ".go-getter", "retrieval"), { recursive: true });
    await writeFile(policyPath(dir), content);
  }

  it("returns null when absent and conformance is off", async () => {
    expect(await loadRetrievalPolicy(dir)).toBeNull();
  });

  it("fails closed when absent in conformance mode", async () => {
    await writeFile(
      join(dir, "virage.config.json"),
      JSON.stringify({ retrieval: { conformance: true } }),
    );
    await expect(loadRetrievalPolicy(dir)).rejects.toThrow(/policy missing/);
  });

  it("enforces a present file even with conformance=false", async () => {
    await writeFile(
      join(dir, "virage.config.json"),
      JSON.stringify({ retrieval: { conformance: false } }),
    );
    await writePolicy("{}");
    await expect(loadRetrievalPolicy(dir)).rejects.toThrow();
    await writePolicy(policyJson());
    expect(await loadRetrievalPolicy(dir)).not.toBeNull();
  });
});
