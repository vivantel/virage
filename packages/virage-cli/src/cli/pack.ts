import { stat } from "fs/promises";
import { resolve } from "path";
import { getVirageDir } from "@vivantel/virage-core";

export interface PackOptions {
  output: string;
  database?: string;
}

export async function runPack(opts: PackOptions): Promise<void> {
  const dbPath = resolve(opts.database ?? `${getVirageDir()}/lancedb`);
  const outputPath = resolve(opts.output);

  // Verify the database directory exists
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

  console.log(`Packing ${dbPath} → ${outputPath}`);

  // Pack the CONTENTS of the db directory (not the directory itself) so that
  // when extracted, the files land directly in the cache directory and the URI
  // can be set to the cache directory without any extra subdirectory component.
  const entries = await readdir(dbPath);

  await create(
    {
      gzip: true,
      file: outputPath,
      cwd: dbPath,
    },
    entries,
  );

  const { stat: statFn } = await import("fs/promises");
  const info = await statFn(outputPath);
  const sizeKb = (info.size / 1024).toFixed(0);

  console.log(`✅ Archive created: ${outputPath} (${sizeKb} KB)`);
  console.log("");
  console.log(
    `To use in eval/suite.json, upload the archive to an HTTPS URL and reference it:`,
  );
  console.log(`  "databases": {`);
  console.log(`    "my-db": { "url": "https://..." }`);
  console.log(`  }`);
}
