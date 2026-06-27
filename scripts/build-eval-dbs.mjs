#!/usr/bin/env node
// Reads eval/suites/retrieval-quality.suite.json, detects distinct indexing databases by signature,
// generates temp configs with unique LanceDB URIs, and outputs a build matrix.
//
// Outputs:
//   .virage/build-matrix.json       — consumed by run-eval-build.mjs
//   .virage/eval-configs/config-*.json — temp indexing configs
//   GITHUB_OUTPUT matrix= / count=  — set when running in CI

import { readFileSync, writeFileSync, mkdirSync, appendFileSync } from 'fs';
import { createHash } from 'crypto';

const suite = JSON.parse(readFileSync('eval/suites/retrieval-quality.suite.json', 'utf8'));

// Resolve the effective chunking config for a database using suite-level
// filesets (immutable) and merging suite + db chunker strategy maps.
// Emits ADR-038 package-based format: { package, include?, ignore? }
function generateChunking(suite, db) {
  const effectiveChunkers = { ...(suite.chunkers ?? {}), ...(db.chunkers ?? {}) };
  const chunkers = Object.entries(effectiveChunkers).map(([filesetName, packageName]) => {
    const fileset = suite.filesets?.[filesetName];
    if (!fileset) throw new Error(`Unknown fileset "${filesetName}" referenced in chunkers`);
    const entry = { package: packageName };
    if (fileset.include?.length) entry.include = fileset.include;
    if (fileset.exclude?.length) entry.ignore = fileset.exclude;
    return entry;
  });
  return { exclude: suite.exclude ?? [], chunkers };
}

// Compute an indexing signature: only fields that affect stored vector content.
// search/reranker/agents are query-time and excluded.
function indexSignature(suite, db) {
  const chunking = generateChunking(suite, db);
  return {
    embedderPackage: db.embedder?.package ?? null,
    model: db.embedder?.config?.model ?? null,
    dimensions: db.embedder?.config?.dimensions ?? null,
    chunkers: chunking.chunkers
      .map((c) => ({
        package: c.package,
        include: [...(c.include ?? [])].sort(),
        ignore: [...(c.ignore ?? [])].sort(),
      }))
      .sort((a, b) => a.package.localeCompare(b.package) || JSON.stringify(a.include).localeCompare(JSON.stringify(b.include))),
  };
}

function signatureHash(sig) {
  return createHash('sha256').update(JSON.stringify(sig)).digest('hex').slice(0, 8);
}

// Validate that all databases have embedder + vectorStore (required for config generation)
for (const [dbName, db] of Object.entries(suite.databases)) {
  if (!db.embedder) throw new Error(`Database "${dbName}" is missing "embedder"`);
  if (!db.vectorStore) throw new Error(`Database "${dbName}" is missing "vectorStore"`);
}

// Group database names by index signature hash
const sigGroups = new Map(); // hash → { sig, hash, dbNames, representativeDb }
for (const [dbName, db] of Object.entries(suite.databases)) {
  const sig = indexSignature(suite, db);
  const hash = signatureHash(sig);

  if (!sigGroups.has(hash)) {
    sigGroups.set(hash, { sig, hash, dbNames: [], representativeDb: db });
  }
  sigGroups.get(hash).dbNames.push(dbName);
}

// Generate temp indexing config files — one per distinct signature
mkdirSync('.virage/eval-configs', { recursive: true });

const matrix = [];

for (const { hash, sig, dbNames, representativeDb: db } of sigGroups.values()) {
  const lancedbPath = `.virage/lancedb-${hash}`;
  const tempConfigPath = `.virage/eval-configs/config-${hash}.json`;

  const chunking = generateChunking(suite, db);

  const tempConfig = {
    chunking,
    embedder: {
      ...db.embedder,
      config: {
        ...db.embedder.config,
        cacheDir: '.virage/model-cache',
      },
    },
    vectorStore: {
      ...db.vectorStore,
      config: {
        ...db.vectorStore.config,
        uri: lancedbPath,
      },
    },
  };

  writeFileSync(tempConfigPath, JSON.stringify(tempConfig, null, 2) + '\n');

  matrix.push({ hash, dbNames, tempConfig: tempConfigPath, lancedbPath });

  console.log(`DB group [${hash}]: ${dbNames.join(', ')}`);
  console.log(`  Embedder : ${sig.embedderPackage} / ${sig.model} (${sig.dimensions ?? 'auto'}d)`);
  console.log(`  Chunkers : ${sig.chunkers.map((c) => c.package).join(', ')}`);
  console.log(`  Config   : ${tempConfigPath}`);
  console.log(`  LanceDB  : ${lancedbPath}`);
}

writeFileSync('.virage/build-matrix.json', JSON.stringify(matrix, null, 2) + '\n');

if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, `matrix=${JSON.stringify(matrix)}\n`);
  appendFileSync(process.env.GITHUB_OUTPUT, `count=${matrix.length}\n`);
}

console.log(`\nDetected ${matrix.length} distinct database(s). Matrix written to .virage/build-matrix.json`);
