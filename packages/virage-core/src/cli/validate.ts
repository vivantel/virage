import { glob } from "glob";
import { loadConfig } from "../config-loader.js";
import { GitTracker } from "../core/git-tracker.js";
import { ConfigError } from "../core/errors.js";

export async function runValidate(configPath: string): Promise<void> {
  console.log(`\n🔍 Validating RAG config: ${configPath}\n`);

  let config;
  try {
    process.stdout.write("📦 Loading config... ");
    config = await loadConfig(configPath);
    console.log("✅");
  } catch (err) {
    console.log("❌");
    throw new ConfigError(
      `Failed to load config: ${err instanceof Error ? err.message : String(err)}`,
      {
        suggestion: "Run `virage init` to generate a new config file.",
        cause: err,
      },
    );
  }

  console.log("\n📂 Scanning files...\n");
  let hasWarnings = false;

  for (const chunker of config.chunkers) {
    const files = await glob(chunker.patterns, { nodir: true });
    const unique = [...new Set(files)];
    const patternsDisplay = chunker.patterns.join(", ");
    console.log(`  Chunker: ${chunker.name} (patterns: ${patternsDisplay})`);

    if (unique.length === 0) {
      console.log(`  ⚠️  No files matched — check your patterns\n`);
      hasWarnings = true;
    } else {
      console.log(`  ✅ Found ${unique.length} matching file(s)\n`);
    }
  }

  const gitTracker = new GitTracker(config.chunkers);
  const allFiles = await gitTracker.getAllTrackedFiles();
  console.log(
    `  Total: ${allFiles.length} file(s) tracked across ${config.chunkers.length} chunker(s)`,
  );

  console.log("\n🔌 Checking vector store...");
  try {
    await config.vectorStore.initialize();
    console.log("  ✅ Vector store connected");
  } catch {
    console.log("  ⚠️  Could not connect — check credentials");
    hasWarnings = true;
  }

  if (hasWarnings) {
    console.log("\n⚠️  Config loaded with warnings.");
  } else {
    console.log("\n✅ Config is valid!");
  }
}
