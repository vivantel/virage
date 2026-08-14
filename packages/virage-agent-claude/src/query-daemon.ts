/**
 * Warm query daemon client (IR-049, virage-ee — Phase 1: session-scoped, not the
 * full machine-wide daemon the IR ultimately proposes).
 *
 * The `search` tool used to `execFileAsync("virage", ["query", ...])` per call —
 * a fresh subprocess every time, re-paying the embedder's ~30s cold start on every
 * single search. This spawns `virage query-serve` once per (repo cwd) and keeps it
 * alive for the lifetime of this MCP server process, sending one newline-delimited
 * JSON request per search and reading one newline-delimited JSON response back —
 * the cold start is paid once per session, not once per query.
 *
 * Falls back to nothing fancy: if the daemon process dies or never starts (older
 * `virage` binary without `query-serve`, spawn failure, etc.), `search()` throws and
 * the caller in server.ts is expected to fall back to the one-shot subprocess path.
 */

import { spawn, type ChildProcessWithoutNullStreams } from "child_process";
import { createInterface } from "readline";

interface QueryRequest {
  query: string;
  top_k?: number;
  branch?: string;
  offset?: number;
}

interface PendingRequest {
  resolve: (rows: unknown[]) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

class DaemonHandle {
  private proc: ChildProcessWithoutNullStreams;
  private queue: PendingRequest[] = [];
  private dead = false;

  constructor(virageBin: string, cwd: string) {
    this.proc = spawn(virageBin, ["query-serve"], {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
    });

    const rl = createInterface({ input: this.proc.stdout });
    rl.on("line", (line) => {
      const pending = this.queue.shift();
      if (!pending) return; // stray line (e.g. a startup log accidentally on stdout)
      clearTimeout(pending.timer);
      try {
        const parsed: unknown = JSON.parse(line);
        if (
          parsed &&
          typeof parsed === "object" &&
          "error" in parsed &&
          typeof (parsed as { error: unknown }).error === "string"
        ) {
          pending.reject(new Error((parsed as { error: string }).error));
        } else if (Array.isArray(parsed)) {
          pending.resolve(parsed);
        } else {
          pending.reject(new Error(`unexpected query-serve response shape: ${line}`));
        }
      } catch (e) {
        pending.reject(e instanceof Error ? e : new Error(String(e)));
      }
    });

    this.proc.on("exit", () => this.killAllPending("query-serve process exited"));
    this.proc.on("error", (e) => this.killAllPending(`query-serve spawn error: ${e.message}`));
  }

  private killAllPending(reason: string) {
    this.dead = true;
    for (const pending of this.queue.splice(0)) {
      clearTimeout(pending.timer);
      pending.reject(new Error(reason));
    }
  }

  get isDead(): boolean {
    return this.dead;
  }

  query(req: QueryRequest, timeoutMs: number): Promise<unknown[]> {
    if (this.dead) return Promise.reject(new Error("query-serve process is dead"));
    return new Promise<unknown[]>((resolve, reject) => {
      const timer = setTimeout(() => {
        const idx = this.queue.findIndex((p) => p.resolve === resolve);
        if (idx !== -1) this.queue.splice(idx, 1);
        reject(new Error(`query-serve request timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      this.queue.push({ resolve, reject, timer });
      this.proc.stdin.write(JSON.stringify(req) + "\n");
    });
  }
}

const daemons = new Map<string, DaemonHandle>();

/**
 * Run a search via the warm daemon for `cwd`, spawning it on first use.
 * Throws if the daemon is unavailable or the request fails — callers should
 * catch and fall back to a one-shot `virage query` subprocess.
 */
export async function daemonSearch(
  virageBin: string,
  cwd: string,
  req: QueryRequest,
  timeoutMs = 35_000,
): Promise<unknown[]> {
  let handle = daemons.get(cwd);
  if (!handle || handle.isDead) {
    handle = new DaemonHandle(virageBin, cwd);
    daemons.set(cwd, handle);
  }
  return handle.query(req, timeoutMs);
}
