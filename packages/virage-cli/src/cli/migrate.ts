import { readFile, writeFile, rename } from "fs/promises";
import { existsSync } from "fs";
import { PACKAGE_TO_BUILTIN } from "@vivantel/virage-core";

interface MigrateOptions {
  config: string;
  output?: string;
  dryRun?: boolean;
}

type RawRef = Record<string, unknown>;

function convertRef(ref: RawRef): RawRef {
  const pkg = ref.package as string | undefined;
  if (pkg) {
    const builtin = PACKAGE_TO_BUILTIN[pkg];
    if (builtin) {
      const result: RawRef = { builtin };
      if (ref.options !== undefined) result.options = ref.options;
      return result;
    }
  }
  return ref;
}

function convertChunkers(chunkers: unknown): unknown {
  if (!Array.isArray(chunkers)) return chunkers;
  return chunkers.map((c) =>
    c && typeof c === "object" ? convertRef(c as RawRef) : c,
  );
}

export async function runMigrate(options: MigrateOptions): Promise<void> {
  const configPath = options.config;
  const outPath = options.output ?? configPath;

  if (!existsSync(configPath)) {
    process.stderr.write(`Config file not found: ${configPath}\n`);
    process.exit(1);
  }

  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(await readFile(configPath, "utf-8")) as Record<
      string,
      unknown
    >;
  } catch (err) {
    process.stderr.write(
      `Cannot read config: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    process.exit(1);
  }

  if (raw.version === "2") {
    process.stdout.write(`${configPath} is already at schema version 2.\n`);
    return;
  }

  const changes: string[] = [];

  // Convert providers to builtin refs
  const providers = raw.providers as Record<string, unknown> | undefined;
  let sourcesMap: Record<string, unknown> | undefined = raw.sources as
    Record<string, unknown> | undefined;

  if (providers) {
    for (const key of [
      "embedder",
      "queryEmbedder",
      "vectorStore",
      "reranker",
    ] as const) {
      const ref = providers[key] as RawRef | undefined;
      if (!ref) continue;
      const converted = convertRef(ref);
      if ("builtin" in converted && !("builtin" in ref)) {
        changes.push(
          `providers.${key}: { package: "${ref.package as string}" } → { builtin: "${converted.builtin as string}" }`,
        );
        providers[key] = converted;
      }
    }

    // Promote providers.source → sources.default
    const srcRef = providers.source as RawRef | undefined;
    if (srcRef) {
      const convertedSrc = convertRef(srcRef);
      if (!sourcesMap) sourcesMap = {};
      if (!sourcesMap.default) {
        sourcesMap.default = convertedSrc;
        changes.push(
          `providers.source → sources.default${
            "builtin" in convertedSrc
              ? ` (converted to builtin: "${convertedSrc.builtin as string}")`
              : ""
          }`,
        );
        delete providers.source;
      }
    }
  }

  // Convert fileSets
  const fileSets = raw.fileSets as Array<Record<string, unknown>> | undefined;
  if (fileSets) {
    for (const fs of fileSets) {
      // Convert inline source ref (if any)
      const fsSource = fs.source as RawRef | string | undefined;
      if (fsSource && typeof fsSource === "object") {
        const converted = convertRef(fsSource);
        if ("builtin" in converted && !("builtin" in fsSource)) {
          changes.push(
            `fileSets["${fs.name as string}"].source: package → builtin`,
          );
          fs.source = converted;
        }
      }
      // If no source set and we have a sources map, reference "default"
      if (fs.source === undefined && sourcesMap?.default !== undefined) {
        fs.source = "default";
        changes.push(
          `fileSets["${fs.name as string}"].source: added reference "default"`,
        );
      }
      // Convert chunkers
      const origChunkers = fs.chunkers;
      const newChunkers = convertChunkers(origChunkers);
      if (JSON.stringify(origChunkers) !== JSON.stringify(newChunkers)) {
        changes.push(
          `fileSets["${fs.name as string}"].chunkers: converted package refs to builtins`,
        );
        fs.chunkers = newChunkers;
      }
    }
  }

  // Assemble updated config with sources inserted before providers
  const omit = new Set(["sources", "providers", "fileSets"]);
  const rest = Object.fromEntries(
    Object.entries(raw).filter(([k]) => !omit.has(k)),
  );
  const updated: Record<string, unknown> = { ...rest, version: "2" };
  if (sourcesMap && Object.keys(sourcesMap).length > 0) {
    updated.sources = sourcesMap;
  }
  if (providers) updated.providers = providers;
  if (fileSets) updated.fileSets = fileSets;

  if (changes.length === 0) {
    process.stdout.write(
      `${configPath}: no package refs to convert, setting version to "2".\n`,
    );
  } else {
    process.stdout.write(`Changes to ${configPath}:\n`);
    for (const c of changes) {
      process.stdout.write(`  • ${c}\n`);
    }
  }

  if (options.dryRun) {
    process.stdout.write("\n[dry-run] No files written.\n");
    return;
  }

  // Backup original when overwriting in-place
  if (outPath === configPath) {
    const backupPath = `${configPath}.v1.bak`;
    await rename(configPath, backupPath);
    process.stdout.write(`Backed up original to ${backupPath}\n`);
  }

  await writeFile(outPath, JSON.stringify(updated, null, 2) + "\n", "utf-8");
  process.stdout.write(`Written: ${outPath}\n`);
}
