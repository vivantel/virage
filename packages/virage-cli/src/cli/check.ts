import { loadConfig } from "@vivantel/virage-core";

export interface CheckOptions {
  config: string;
}

export async function runCheck(opts: CheckOptions): Promise<void> {
  const cfg = await loadConfig(opts.config);
  await cfg.vectorStore.initialize();

  const stored = await cfg.vectorStore.readMeta?.();

  if (!stored) {
    console.log(
      "⚠️  No embedder metadata found in the index.\n" +
        "   This index was built before virage check was available, or the index is empty.\n" +
        "   Run `virage index` to write metadata.",
    );
    return;
  }

  const builtAt = new Date(stored.createdAt * 1000).toLocaleString();
  const dimMismatch = stored.dimensions !== cfg.embedder.dimensions;
  const modelMismatch =
    stored.model && cfg.embedder.model && stored.model !== cfg.embedder.model;

  console.log("\n📋 Index metadata");
  console.log("─".repeat(50));
  console.log(`  Provider   : ${stored.providerName}`);
  console.log(`  Model      : ${stored.model ?? "(unknown)"}`);
  console.log(`  Dimensions : ${stored.dimensions}`);
  if (stored.distanceMetric) {
    console.log(`  Distance   : ${stored.distanceMetric}`);
  }
  console.log(`  Built at   : ${builtAt}`);
  console.log("─".repeat(50));

  if (dimMismatch || modelMismatch) {
    console.log("\n❌ Mismatch with current config:");
    if (dimMismatch) {
      console.log(
        `   Index dims  : ${stored.dimensions} → config dims: ${cfg.embedder.dimensions}`,
      );
    }
    if (modelMismatch) {
      console.log(
        `   Index model : ${stored.model} → config model: ${cfg.embedder.model}`,
      );
    }
    console.log("\n   Fix: run `virage index --force` to rebuild the index.");
    process.exitCode = 1;
  } else {
    console.log("\n✅ Index is compatible with the current embedder config.");
  }
}
