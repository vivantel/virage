#!/usr/bin/env node
// Reads eval/suite.json, groups variant configs by index signature, and produces
// a build matrix: one entry per distinct (embedder + chunker) combination.
//
// Outputs:
//   .virage/build-matrix.json       — consumed by the workflow build step
//   .virage/eval-configs/config-*.json — temp configs with unique LanceDB URIs
//   GITHUB_OUTPUT matrix= / count=  — set when running in CI

import { readFileSync, writeFileSync, mkdirSync, appendFileSync } from 'fs';
import { createHash } from 'crypto';
import { resolve } from 'path';

const suite = JSON.parse(readFileSync('eval/suite.json', 'utf8'));

function resolveVariantConfig(configPath) {
  // Paths in suite.json are relative to the eval/ directory
  return resolve('eval', configPath);
}

// Only fields that affect stored vector content are part of the signature.
// search.hybrid, search.reranker, and agents are query-time and excluded.
function indexSignature(config) {
  const rawChunkers = config.chunking?.chunkers ?? config.chunkers ?? [];
  const chunkers = rawChunkers
    .map((c) => ({
      strategy: c.strategy,
      patterns: [...(c.patterns ?? [])].sort(),
      ignorePatterns: [...(c.ignorePatterns ?? [])].sort(),
    }))
    .sort((a, b) => a.strategy.localeCompare(b.strategy));

  return {
    embedderPackage: config.embedder.package,
    model: config.embedder.config.model,
    dimensions: config.embedder.config.dimensions ?? null,
    chunkers,
  };
}

function signatureHash(sig) {
  return createHash('sha256').update(JSON.stringify(sig)).digest('hex').slice(0, 8);
}

// Map each database name to the first variant config that references it
const dbToConfigPath = new Map();
for (const variant of suite.variants) {
  if (!dbToConfigPath.has(variant.database)) {
    dbToConfigPath.set(variant.database, variant.config);
  }
}

// Group database names by their index signature hash
const sigGroups = new Map(); // hash → { sig, hash, dbNames, representativeConfig }
for (const [dbName, configPath] of dbToConfigPath) {
  const absPath = resolveVariantConfig(configPath);
  const config = JSON.parse(readFileSync(absPath, 'utf8'));
  const sig = indexSignature(config);
  const hash = signatureHash(sig);

  if (!sigGroups.has(hash)) {
    sigGroups.set(hash, { sig, hash, dbNames: [], representativeConfig: config });
  }
  sigGroups.get(hash).dbNames.push(dbName);
}

// Generate temp config files — one per distinct signature, with a unique LanceDB URI
mkdirSync('.virage/eval-configs', { recursive: true });

const matrix = [];

for (const { hash, sig, dbNames, representativeConfig } of sigGroups.values()) {
  const lancedbPath = `.virage/lancedb-${hash}`;
  const tempConfigPath = `.virage/eval-configs/config-${hash}.json`;

  // Build a minimal indexing-only config: strip search/agents/pluginVersions,
  // override the LanceDB URI, and pin the shared model cache directory.
  const chunkingSection =
    representativeConfig.chunking ?? { chunkers: representativeConfig.chunkers };

  const tempConfig = {
    chunking: chunkingSection,
    embedder: {
      ...representativeConfig.embedder,
      config: {
        ...representativeConfig.embedder.config,
        cacheDir: '.virage/model-cache',
      },
    },
    vectorStore: {
      ...representativeConfig.vectorStore,
      config: {
        ...representativeConfig.vectorStore.config,
        uri: lancedbPath,
      },
    },
  };

  writeFileSync(tempConfigPath, JSON.stringify(tempConfig, null, 2) + '\n');

  matrix.push({ hash, dbNames, tempConfig: tempConfigPath, lancedbPath });

  console.log(`DB group [${hash}]: ${dbNames.join(', ')}`);
  console.log(`  Embedder : ${sig.embedderPackage} / ${sig.model} (${sig.dimensions ?? 'auto'}d)`);
  console.log(`  Chunkers : ${sig.chunkers.map((c) => c.strategy).join(', ')}`);
  console.log(`  Config   : ${tempConfigPath}`);
  console.log(`  LanceDB  : ${lancedbPath}`);
}

writeFileSync('.virage/build-matrix.json', JSON.stringify(matrix, null, 2) + '\n');

if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, `matrix=${JSON.stringify(matrix)}\n`);
  appendFileSync(process.env.GITHUB_OUTPUT, `count=${matrix.length}\n`);
}

console.log(`\nDetected ${matrix.length} distinct database(s). Matrix written to .virage/build-matrix.json`);
