import { stat } from "fs/promises";
import { resolve } from "path";
import { getVirageDir } from "@vivantel/virage-core";
import { createOut } from "../output.js";
import { withSpinner } from "../spinner.js";

export interface PackOptions {
  output: string;
  database?: string;
  verbosity?: number;
}

export async function runPack(opts: PackOptions): Promise<void> {
  const out = createOut(opts.verbosity ?? 0);
  const dbPath = resolve(opts.database ?? `${getVirageDir()}/lancedb`);
  const outputPath = resolve(opts.output);

  try {
    const info = await stat(dbPath);
    if (!info.isDirectory()) {
      throw new Error(`Not a directory: ${dbPath}`);
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(
        `LanceDB directory not found: ${dbPath}\nRun "virage index" first to build the index.`,
        { cause: err },
      );
    }
    throw err;
  }

  const { create } = await import("tar");
  const { readdir } = await import("fs/promises");

  const entries = await readdir(dbPath);

  await withSpinner(`Packing ${dbPath} → ${outputPath}`, () =>
    create({ gzip: true, file: outputPath, cwd: dbPath }, entries),
  );

  const { stat: statFn } = await import("fs/promises");
  const info = await statFn(outputPath);
  const sizeKb = (info.size / 1024).toFixed(0);

  out.success(`Archive created: ${outputPath} (${sizeKb} KB)`);
  out.info(
    "To use in eval/suites/retrieval-quality.json, upload the archive to an HTTPS URL and reference it:",
  );
  out.dim(`  "databases": {`);
  out.dim(`    "my-db": { "url": "https://..." }`);
  out.dim(`  }`);
}
