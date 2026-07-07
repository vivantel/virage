import { createHash } from "crypto";
import { readFile, writeFile, rename } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

export interface SessionState {
  hashes: string[];
  createdAt: string;
}

export function sessionStatePath(sessionId: string): string {
  return join(tmpdir(), `virage-claude-${sessionId}.json`);
}

export async function loadSessionState(
  sessionId: string,
): Promise<SessionState> {
  try {
    const raw = await readFile(sessionStatePath(sessionId), "utf-8");
    const parsed = JSON.parse(raw) as Partial<SessionState>;
    return {
      hashes: parsed.hashes ?? [],
      createdAt: parsed.createdAt ?? new Date().toISOString(),
    };
  } catch {
    return { hashes: [], createdAt: new Date().toISOString() };
  }
}

export async function saveSessionState(
  sessionId: string,
  state: SessionState,
): Promise<void> {
  try {
    const path = sessionStatePath(sessionId);
    const tmp = path + ".tmp";
    await writeFile(tmp, JSON.stringify(state));
    await rename(tmp, path);
  } catch {
    // Non-fatal — session dedup silently degrades if /tmp is unavailable
  }
}

export function hashChunk(denseText: string): string {
  return createHash("sha256")
    .update(denseText, "utf-8")
    .digest("hex")
    .slice(0, 16);
}
