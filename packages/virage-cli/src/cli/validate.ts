import { glob } from "glob";
import {
  loadConfig,
  GitTracker,
  CliGitSourceRepository,
  ConfigError,
  IGNORED_DIRS,
} from "@vivantel/virage-core";
import { detectFileExtensions } from "./file-detect.js";
import { out } from "../output.js";

export async function runValidate(configPath: string): Promise<void> {
  const cwd = process.cwd();
  out.section(`🔍 Validating RAG config: ${configPath}`);
  console.log();

  let config;
  try {
    process.stdout.write("📦 Loading config... ");
    config = await loadConfig(configPath);
    out.success("done");
  } catch (err) {
    out.error("failed");
    throw new ConfigError(
      `Failed to load config: ${err instanceof Error ? err.message : String(err)}`,
      {
        suggestion: "Run `virage init` to generate a new config file.",
        cause: err,
      },
    );
  }

  out.section("📂 Scanning files...");
  console.log();
  let hasWarnings = false;

  const excludeIgnore = [
    ...[...IGNORED_DIRS].map((d) => `${d}/**`),
    ...(config.excludePatterns ?? []),
  ];

  for (const chunker of config.chunkers) {
    const files = await glob(chunker.patterns, {
      nodir: true,
      ignore: excludeIgnore,
    });
    const unique = [...new Set(files)];
    const patternsDisplay = chunker.patterns.join(", ");
    out.dim(`  Chunker: ${chunker.name} (patterns: ${patternsDisplay})`);

    if (unique.length === 0) {
      out.warn(`  No files matched — check your patterns`);
      hasWarnings = true;
    } else {
      out.success(`  Found ${unique.length} matching file(s)`);
    }
    console.log();
  }

  const gitTracker = new GitTracker(
    config.chunkers,
    new CliGitSourceRepository(
      process.cwd(),
      undefined,
      config.excludePatterns,
    ),
    undefined,
    config.excludePatterns,
  );
  const allFiles = await gitTracker.getAllTrackedFiles();
  out.dim(
    `  Total: ${allFiles.length} file(s) tracked across ${config.chunkers.length} chunker(s)`,
  );

  out.section("🔌 Checking vector store...");
  try {
    await config.vectorStore.initialize();
    out.success("  Vector store connected");
  } catch {
    out.warn("  Could not connect — check credentials");
    hasWarnings = true;
  }

  out.section("📁 Checking file type coverage...");
  const detectedGroups = await detectFileExtensions(cwd);
  if (detectedGroups.length === 0) {
    out.dim("  No known file types detected in project");
  } else {
    const allPatterns = config.chunkers.flatMap((c) => c.patterns);
    for (const group of detectedGroups) {
      const covered = group.exts.some((ext) =>
        allPatterns.some((p) => p.includes(`*${ext}`) || p.includes(`${ext}`)),
      );
      if (covered) {
        out.success(`  ${group.name} (${group.exts.join(", ")}) — covered`);
      } else {
        out.warn(
          `  ${group.name} (${group.exts.join(", ")}) — not covered by any chunker`,
        );
        hasWarnings = true;
      }
    }
  }

  console.log();
  if (hasWarnings) {
    out.warn("Config loaded with warnings.");
  } else {
    out.success("Config is valid!");
  }
}
