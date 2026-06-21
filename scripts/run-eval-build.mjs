#!/usr/bin/env node
// Runs virage index + pack for each entry in .virage/build-matrix.json.
//
// This is a standalone top-level script (not piped via heredoc) so that child
// processes inherit a clean stdin ('ignore') rather than an EOF pipe, which
// causes the ONNX model loader to terminate prematurely.

import { spawnSync } from 'child_process';
import { readFileSync, mkdirSync, copyFileSync, appendFileSync } from 'fs';
import { createHash } from 'crypto';
import { join } from 'path';

const matrix = JSON.parse(readFileSync('.virage/build-matrix.json', 'utf8'));
const virage = process.env.VIRAGE_BIN;

if (!virage) {
  console.error('Error: VIRAGE_BIN environment variable is required.');
  process.exit(1);
}

const digests = {};

for (const item of matrix) {
  console.log(`\n=== Indexing DB: ${item.dbNames.join(', ')} (hash=${item.hash}) ===`);

  const indexResult = spawnSync(virage, ['index', '--config', item.tempConfig], {
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  if (indexResult.status !== 0) {
    console.error(`\nIndex failed with exit code ${indexResult.status ?? 'unknown'}`);
    process.exit(indexResult.status ?? 1);
  }

  for (const dbName of item.dbNames) {
    const tarball = `${dbName}.tar.gz`;

    // Store the generated index config inside the lancedb dir so it's included
    // in the archive. Users can reproduce the exact indexing setup from the archive.
    const configsDir = join(item.lancedbPath, 'configs');
    mkdirSync(configsDir, { recursive: true });
    copyFileSync(item.tempConfig, join(configsDir, 'index.json'));

    console.log(`\nPacking ${tarball}...`);
    const packResult = spawnSync(virage, ['pack', '--output', tarball, '--database', item.lancedbPath], {
      stdio: ['ignore', 'inherit', 'inherit'],
    });
    if (packResult.status !== 0) {
      console.error(`\nPack failed with exit code ${packResult.status ?? 'unknown'}`);
      process.exit(packResult.status ?? 1);
    }

    const bytes = readFileSync(tarball);
    digests[dbName] = createHash('sha256').update(bytes).digest('hex');
    console.log(`sha256: ${digests[dbName]}`);
  }
}

if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, `digests=${JSON.stringify(digests)}\n`);
}

console.log('\nAll databases built and packed successfully.');
