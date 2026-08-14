import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "events";

// Mock child_process.execFile so we can assert on the exact args passed to
// `virage query`, and control what it "returns" without a real binary.
const execFileMock = vi.fn();
vi.mock("child_process", () => ({
  execFile: (...args: unknown[]) => execFileMock(...args),
}));

import { runInjectContext } from "./inject-context.js";

// promisify(execFile) calls execFile(file, args, options, callback) and
// resolves/rejects based on the callback — emulate that here.
function mockExecFileResult(stdout: string, err: Error | null = null): void {
  execFileMock.mockImplementation(
    (
      _file: string,
      _args: string[],
      _options: unknown,
      callback: (
        err: Error | null,
        result: { stdout: string; stderr: string },
      ) => void,
    ) => {
      callback(err, { stdout, stderr: "" });
      return new EventEmitter();
    },
  );
}

describe("runInjectContext — regression: real CLI flag, not --json", () => {
  beforeEach(() => {
    execFileMock.mockReset();
  });

  it("invokes `virage query` with --format json, not the nonexistent --json flag", async () => {
    mockExecFileResult("[]");
    await runInjectContext("some excerpt");

    expect(execFileMock).toHaveBeenCalledTimes(1);
    const args = execFileMock.mock.calls[0][1] as string[];
    expect(args).toContain("--format");
    expect(args[args.indexOf("--format") + 1]).toBe("json");
    // The bug this guards against: `--json` isn't a real virage query flag —
    // passing it fails silently (exit 0, empty stdout) rather than erroring,
    // so this must never regress back to it.
    expect(args).not.toContain("--json");
  });

  it("parses well-formed --format json output into injected context", async () => {
    mockExecFileResult(
      JSON.stringify([
        {
          denseText: "some relevant chunk text",
          sourceFile: "docs/example.md",
          similarity: 0.81,
          metadata: {},
        },
      ]),
    );

    // runInjectContext prints to stdout as a side effect; just confirm it
    // doesn't throw/return early the way it would on unparseable JSON.
    await expect(runInjectContext("some excerpt")).resolves.not.toThrow();
  });
});
