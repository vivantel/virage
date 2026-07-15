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
    const fileSets = raw.fileSets as
      Array<{ chunkers?: unknown[] }> | undefined;
    const chunkerCount = fileSets
      ? fileSets.reduce((sum, fs) => sum + (fs.chunkers?.length ?? 0), 0)
      : 0;
    type RawRef = { package?: string; builtin?: string } | undefined;
    const embedderRef = raw.providers?.embedder as RawRef;
    const storeRef = raw.providers?.vectorStore as RawRef;
    const embedder =
      embedderRef?.builtin ??
      embedderRef?.package?.split("/").pop() ??
      "unknown";
    const store =
      storeRef?.builtin ?? storeRef?.package?.split("/").pop() ?? "unknown";
    const noBanner = raw.pipeline?.noBanner as boolean | undefined;
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
  // eslint-disable-next-line no-console
  console.log(`\x1b[1mVirage\x1b[0m v${version}${configInfo}`);
}
