import { createRequire } from "module";
import { readFileSync } from "fs";

function cliVersion(): string {
  try {
    const require = createRequire(import.meta.url);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pkg = require("../../package.json") as any;
    return (pkg.version as string | undefined) ?? "?";
  } catch {
    return "?";
  }
}

interface RawConfigSummary {
  chunkerCount: number;
  embedder: string;
  store: string;
  noBanner?: boolean;
}

function readConfigSummary(configPath: string): RawConfigSummary | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const raw = JSON.parse(readFileSync(configPath, "utf8")) as any;
    const chunkerCount = Array.isArray(
      (raw.chunking as { chunkers?: unknown } | undefined)?.chunkers,
    )
      ? (raw.chunking as { chunkers: unknown[] }).chunkers.length
      : 0;
    const embedder =
      (raw.embedder?.package as string | undefined)?.split("/").pop() ??
      "unknown";
    const store =
      (raw.vectorStore?.package as string | undefined)?.split("/").pop() ??
      "unknown";
    const noBanner = raw.options?.noBanner as boolean | undefined;
    return { chunkerCount, embedder, store, noBanner };
  } catch {
    return null;
  }
}

export function printBanner(
  configPath?: string,
  forceSuppressed?: boolean,
): void {
  if (!process.stdout.isTTY) return;
  if (forceSuppressed) return;
  if (process.env["VIRAGE_NO_BANNER"] === "1") return;

  const summary = configPath ? readConfigSummary(configPath) : null;

  if (summary?.noBanner) return;

  const version = cliVersion();
  const configInfo = summary
    ? `  \x1b[2m${summary.chunkerCount} chunker${summary.chunkerCount !== 1 ? "s" : ""} · ${summary.embedder} · ${summary.store}\x1b[0m`
    : "";
  console.log(`\x1b[1mVirage\x1b[0m v${version}${configInfo}`);
}
