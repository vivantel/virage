import { loadConfig } from "@vivantel/virage-core";
import { createOut } from "../output.js";
import { withSpinner } from "../spinner.js";

export interface CheckOptions {
  config: string;
  verbosity: number;
}

export async function runCheck(opts: CheckOptions): Promise<void> {
  const out = createOut(opts.verbosity);
  const cfg = await loadConfig(opts.config);

  const stored = await withSpinner("Reading index metadata", async () => {
    await cfg.vectorStore.initialize();
    return cfg.vectorStore.readMeta?.();
  });

  if (!stored) {
    out.warn(
      "No embedder metadata found in the index.\n" +
        "   This index was built before virage check was available, or the index is empty.\n" +
        "   Run `virage index` to write metadata.",
    );
    return;
  }

  const builtAt = new Date(stored.createdAt * 1000).toLocaleString();
  const dimMismatch = stored.dimensions !== cfg.embedder.dimensions;
  const modelMismatch =
    stored.model && cfg.embedder.model && stored.model !== cfg.embedder.model;

  out.section("📋 Index metadata");
  out.info(`  Provider   : ${stored.providerName}`);
  out.info(`  Model      : ${stored.model ?? "(unknown)"}`);
  out.info(`  Dimensions : ${stored.dimensions}`);
  if (stored.distanceMetric) {
    out.info(`  Distance   : ${stored.distanceMetric}`);
  }
  out.info(`  Built at   : ${builtAt}`);
  out.divider();

  if (dimMismatch || modelMismatch) {
    out.error("Mismatch with current config:");
    if (dimMismatch) {
      out.info(
        `   Index dims  : ${stored.dimensions} → config dims: ${cfg.embedder.dimensions}`,
      );
    }
    if (modelMismatch) {
      out.info(
        `   Index model : ${stored.model} → config model: ${cfg.embedder.model}`,
      );
    }
    out.info("   Fix: run `virage index --force` to rebuild the index.");
    process.exitCode = 1;
  } else {
    out.success("Index is compatible with the current embedder config.");
  }
}
