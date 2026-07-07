import { execFile } from "child_process";
import { existsSync } from "fs";
import { join } from "path";
import { promisify } from "util";
import {
  loadSessionState,
  saveSessionState,
  hashChunk,
} from "./session-state.js";

const execFileAsync = promisify(execFile);

const DEFAULT_TOP_K = 5;
const DEFAULT_MIN_SIMILARITY = 0.65;
const TOKEN_BUDGET = 2000;
const CHUNK_CHAR_LIMIT = 800;

interface SearchResult {
  denseText: string;
  sourceFile: string;
  similarity: number;
  metadata: Record<string, unknown>;
}

function virageBin(cwd: string): string {
  const local = join(cwd, "node_modules", ".bin", "virage");
  return existsSync(local) ? local : "virage";
}

function formatContext(results: SearchResult[]): string {
  const lines: string[] = ["\n# Virage RAG Context\n"];
  let budget = TOKEN_BUDGET;
  for (const c of results) {
    const text = c.denseText.slice(0, CHUNK_CHAR_LIMIT);
    const tokens = Math.ceil(text.length / 4);
    if (lines.length > 1 && budget - tokens < 0) break;
    budget -= tokens;
    lines.push(
      `## ${c.sourceFile ?? "?"} (${Math.round(c.similarity * 100)}%)\n${text}\n`,
    );
  }
  return lines.length > 1 ? lines.join("\n") : "";
}

export interface InjectContextOptions {
  sessionId?: string;
  configPath?: string;
}

export async function runInjectContext(
  excerpt: string,
  opts: InjectContextOptions = {},
): Promise<void> {
  const cwd = process.cwd();
  const bin = virageBin(cwd);
  const config = opts.configPath ?? "./virage.config.json";

  const args = [
    "query",
    excerpt,
    "--json",
    "--top-k",
    String(DEFAULT_TOP_K),
    "--min-similarity",
    String(DEFAULT_MIN_SIMILARITY),
    "--config",
    config,
  ];

  let stdout: string;
  try {
    ({ stdout } = await execFileAsync(bin, args, { cwd, timeout: 30_000 }));
  } catch {
    return; // Silent fail — no index or virage not installed
  }

  let results: SearchResult[];
  try {
    results = JSON.parse(stdout.trim()) as SearchResult[];
  } catch {
    return;
  }

  if (!results.length) return;

  // Session-level deduplication
  if (opts.sessionId) {
    const state = await loadSessionState(opts.sessionId);
    const seen = new Set(state.hashes);
    const newHashes: string[] = [];
    results = results.filter((r) => {
      const h = hashChunk(r.denseText);
      if (seen.has(h)) return false;
      newHashes.push(h);
      return true;
    });
    if (newHashes.length > 0) {
      state.hashes.push(...newHashes);
      await saveSessionState(opts.sessionId, state);
    }
    if (!results.length) return;
  }

  const output = formatContext(results);
  if (output) process.stdout.write(output);
}
