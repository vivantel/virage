import { readFile } from "fs/promises";
import { dirname, resolve } from "path";
import { VirageDb, defaultVirageDb } from "@vivantel/virage-core";
import type { EvalSuite } from "@vivantel/virage-core";
import { runSuite } from "@vivantel/virage-core";
import { createLogger } from "../logger/index.js";

export interface EvalSuiteRunOptions {
  suite: string;
  ci: boolean;
  json: boolean;
  noCache: boolean;
  verbose: number;
}

export async function runEvalSuite(opts: EvalSuiteRunOptions): Promise<void> {
  const suitePath = resolve(opts.suite);
  const suiteDir = dirname(suitePath);

  let suite: EvalSuite;
  try {
    suite = JSON.parse(await readFile(suitePath, "utf-8")) as EvalSuite;
  } catch (err) {
    throw new Error(`Cannot read eval suite config: ${opts.suite}`, {
      cause: err,
    });
  }

  if (suite.version !== "1") {
    throw new Error(
      `Unsupported eval suite version: "${suite.version}". Expected "1".`,
    );
  }

  const activeVariants = suite.variants.filter((v) => !v.skip);
  const baselineVariant = activeVariants.find((v) => v.name === suite.baseline);
  if (!baselineVariant) {
    throw new Error(
      `Baseline variant "${suite.baseline}" is not found or is skipped in ${opts.suite}.`,
    );
  }

  console.log("");
  console.log(`Virage Eval Suite`);
  console.log(`  suite: ${opts.suite}`);
  console.log(
    `  ${activeVariants.length} variant(s)  baseline: ${suite.baseline}`,
  );
  console.log("");

  const logger = createLogger(opts.verbose);
  const db = new VirageDb(defaultVirageDb());
  let result;
  try {
    result = await runSuite(suite, suiteDir, db, {
      noCache: opts.noCache,
      logger,
      verbosity: opts.verbose,
    });
  } finally {
    db.close();
  }

  if (opts.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log("");

  if (!result.ciPassed && opts.ci) {
    process.exit(1);
  }
}
