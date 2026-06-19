import { describe, it, expect, vi, beforeEach } from "vitest";
import { IsomorphicGitSourceRepository } from "./isomorphic-git-source-repo.js";

// ── Mock isomorphic-git ────────────────────────────────────────────────────────

const mockResolveRef = vi.fn();
const mockWalk = vi.fn();
const mockStatusMatrix = vi.fn();
const mockCurrentBranch = vi.fn();
const mockTREE = vi.fn((opts: unknown) => opts);

vi.mock("isomorphic-git", () => ({
  default: {
    resolveRef: (...args: unknown[]) => mockResolveRef(...args),
    walk: (...args: unknown[]) => mockWalk(...args),
    statusMatrix: (...args: unknown[]) => mockStatusMatrix(...args),
    currentBranch: (...args: unknown[]) => mockCurrentBranch(...args),
  },
  TREE: (opts: unknown) => mockTREE(opts),
}));

// ── Mock node:fs to avoid real file I/O ───────────────────────────────────────

vi.mock("node:fs", () => ({
  readFileSync: vi.fn().mockReturnValue(Buffer.from("hello")),
}));

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeEntry(oid: string, type = "blob") {
  return {
    oid: vi.fn().mockResolvedValue(oid),
    type: vi.fn().mockResolvedValue(type),
  };
}

function makeRepo(dir = "/repo") {
  return new IsomorphicGitSourceRepository(dir);
}

const HEAD_SHA = "abc123def456abc123def456abc123def456abc1";
const PREV_SHA = "000111222333000111222333000111222333000a";

beforeEach(() => {
  vi.clearAllMocks();
  mockResolveRef.mockResolvedValue(HEAD_SHA);
  mockStatusMatrix.mockResolvedValue([]);
  mockCurrentBranch.mockResolvedValue("main");
});

// ── getCurrentRevision ─────────────────────────────────────────────────────────

describe("getCurrentRevision", () => {
  it("returns the HEAD SHA", async () => {
    const repo = makeRepo();
    const rev = await repo.getCurrentRevision();
    expect(rev).toBe(HEAD_SHA);
    expect(mockResolveRef).toHaveBeenCalledWith(
      expect.objectContaining({ ref: "HEAD" }),
    );
  });
});

// ── getFileRevisions ───────────────────────────────────────────────────────────

describe("getFileRevisions", () => {
  it("returns empty map for empty files list", async () => {
    const repo = makeRepo();
    const result = await repo.getFileRevisions([]);
    expect(result.size).toBe(0);
    expect(mockWalk).not.toHaveBeenCalled();
  });

  it("returns blob OIDs from HEAD tree for clean files", async () => {
    const blobSha = "blobsha1".padEnd(40, "0");
    // Simulate walk calling map with (filepath, [entry])
    mockWalk.mockImplementation(
      async ({
        map,
      }: {
        map: (p: string, e: unknown[]) => Promise<unknown>;
      }) => {
        await map("src/foo.ts", [makeEntry(blobSha)]);
        await map("src/dir", [makeEntry("treeSha", "tree")]);
      },
    );

    const repo = makeRepo();
    const result = await repo.getFileRevisions(["src/foo.ts"]);
    expect(result.get("src/foo.ts")).toBe(blobSha);
    expect(result.size).toBe(1);
  });

  it("calls onProgress for each file", async () => {
    mockWalk.mockImplementation(
      async ({
        map,
      }: {
        map: (p: string, e: unknown[]) => Promise<unknown>;
      }) => {
        await map("a.ts", [makeEntry("sha1".padEnd(40, "0"))]);
        await map("b.ts", [makeEntry("sha2".padEnd(40, "0"))]);
      },
    );

    const repo = makeRepo();
    const calls: [number, number][] = [];
    await repo.getFileRevisions(["a.ts", "b.ts"], (done, total) =>
      calls.push([done, total]),
    );
    expect(calls).toEqual([
      [1, 2],
      [2, 2],
    ]);
  });

  it("uses computed SHA for dirty files", async () => {
    // Mark src/bar.ts as dirty (workdir !== head)
    mockStatusMatrix.mockResolvedValue([["src/bar.ts", 1, 2, 1]]);
    // Tree contains old SHA for src/bar.ts
    const oldSha = "oldshaold".padEnd(40, "0");
    mockWalk.mockImplementation(
      async ({
        map,
      }: {
        map: (p: string, e: unknown[]) => Promise<unknown>;
      }) => {
        await map("src/bar.ts", [makeEntry(oldSha)]);
      },
    );

    const repo = makeRepo();
    const result = await repo.getFileRevisions(["src/bar.ts"]);
    // Should NOT use the tree SHA — must compute from file content
    expect(result.get("src/bar.ts")).not.toBe(oldSha);
    // The mocked readFileSync returns Buffer('hello'), so sha1 of "blob 5\0hello"
    expect(result.get("src/bar.ts")).toMatch(/^[0-9a-f]{40}$/);
  });
});

// ── getChangedFilesSince ───────────────────────────────────────────────────────

describe("getChangedFilesSince", () => {
  it("returns null when walk throws (unknown revision)", async () => {
    mockWalk.mockRejectedValue(new Error("unknown commit"));
    const repo = makeRepo();
    const result = await repo.getChangedFilesSince("unknownsha");
    expect(result).toBeNull();
  });

  it("categorises added, modified, and deleted files", async () => {
    const sha1 = "aaaa".padEnd(40, "0");
    const sha2 = "bbbb".padEnd(40, "0");
    const sha3 = "cccc".padEnd(40, "0");

    mockWalk.mockImplementation(
      async ({
        map,
      }: {
        map: (p: string, e: unknown[]) => Promise<unknown>;
      }) => {
        // added: exists in HEAD only
        await map("new.ts", [makeEntry(sha1), null]);
        // deleted: exists in prev only
        await map("removed.ts", [null, makeEntry(sha2)]);
        // modified: different OIDs
        await map("changed.ts", [makeEntry(sha1), makeEntry(sha3)]);
        // unchanged: same OIDs
        await map("same.ts", [makeEntry(sha1), makeEntry(sha1)]);
        // root entry: should be skipped
        await map(".", [makeEntry(sha1), makeEntry(sha1)]);
      },
    );

    const repo = makeRepo();
    const result = await repo.getChangedFilesSince(PREV_SHA);
    expect(result).not.toBeNull();
    expect(result!.added).toContain("new.ts");
    expect(result!.deleted).toContain("removed.ts");
    expect(result!.modified).toContain("changed.ts");
    expect(result!.added).not.toContain("same.ts");
    expect(result!.modified).not.toContain("same.ts");
  });

  it("skips tree entries when walking two trees", async () => {
    mockWalk.mockImplementation(
      async ({
        map,
      }: {
        map: (p: string, e: unknown[]) => Promise<unknown>;
      }) => {
        // directory entry — must be skipped
        await map("src", [makeEntry("sha", "tree"), makeEntry("sha", "tree")]);
      },
    );

    const repo = makeRepo();
    const result = await repo.getChangedFilesSince(PREV_SHA);
    expect(result).toEqual({ added: [], modified: [], deleted: [] });
  });
});

// ── getContext ─────────────────────────────────────────────────────────────────

describe("getContext", () => {
  it("returns the current branch name", async () => {
    const repo = makeRepo();
    expect(await repo.getContext()).toBe("main");
  });

  it("returns HEAD when currentBranch throws", async () => {
    mockCurrentBranch.mockRejectedValue(new Error("detached"));
    const repo = makeRepo();
    expect(await repo.getContext()).toBe("HEAD");
  });

  it("returns HEAD when currentBranch returns null (detached HEAD)", async () => {
    mockCurrentBranch.mockResolvedValue(null);
    const repo = makeRepo();
    expect(await repo.getContext()).toBe("HEAD");
  });
});

// ── getPendingChanges ──────────────────────────────────────────────────────────

describe("getPendingChanges", () => {
  it("returns dirty files from statusMatrix", async () => {
    mockStatusMatrix.mockResolvedValue([
      ["clean.ts", 1, 1, 1], // clean — head=workdir=stage
      ["dirty.ts", 1, 2, 1], // modified workdir
      ["staged.ts", 1, 1, 2], // staged
    ]);

    const repo = makeRepo();
    const pending = await repo.getPendingChanges();
    expect(pending.has("dirty.ts")).toBe(true);
    expect(pending.has("staged.ts")).toBe(true);
    expect(pending.has("clean.ts")).toBe(false);
  });

  it("returns empty set when statusMatrix throws", async () => {
    mockStatusMatrix.mockRejectedValue(new Error("not a git repo"));
    const repo = makeRepo();
    const pending = await repo.getPendingChanges();
    expect(pending.size).toBe(0);
  });
});

// ── factory export ─────────────────────────────────────────────────────────────

describe("createSourceRepository", () => {
  it("creates an instance with the provided dir", async () => {
    const { createSourceRepository } = await import("./index.js");
    const repo = createSourceRepository({ dir: "/my/repo" });
    expect(repo.rootUri).toBe("/my/repo");
  });

  it("defaults to process.cwd() when dir is not specified", async () => {
    const { createSourceRepository } = await import("./index.js");
    const repo = createSourceRepository({});
    expect(repo.rootUri).toBe(process.cwd());
  });
});
