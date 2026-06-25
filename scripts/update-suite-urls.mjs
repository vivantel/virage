#!/usr/bin/env node
// Patches eval/suites/retrieval-quality.json with new GitHub release download URLs, SHA-256 digests,
// and captured plugin versions.
//
// Reads from environment variables (safe for JSON values in CI):
//   RELEASE_TAG          — e.g. eval-db-2026-06-21-abc1234
//   DIGESTS              — JSON object mapping dbName → sha256 hex string
//   PLUGIN_VERSIONS      — JSON object mapping package → version (optional)
//   GITHUB_REPOSITORY    — e.g. vivantel/virage (defaults to vivantel/virage)

import { readFileSync, writeFileSync } from 'fs';

const tag = process.env.RELEASE_TAG;
const digests = JSON.parse(process.env.DIGESTS ?? '{}');
const pluginVersions = JSON.parse(process.env.PLUGIN_VERSIONS ?? '{}');
const repo = process.env.GITHUB_REPOSITORY ?? 'vivantel/virage';

if (!tag) {
  console.error('Error: RELEASE_TAG environment variable is required.');
  process.exit(1);
}

const suiteRaw = readFileSync('eval/suites/retrieval-quality.json', 'utf8');
const suite = JSON.parse(suiteRaw);

const baseUrl = `https://github.com/${repo}/releases/download/${tag}`;

for (const [dbName, dbEntry] of Object.entries(suite.databases)) {
  const url = `${baseUrl}/${dbName}.tar.gz`;
  suite.databases[dbName] = {
    ...dbEntry,
    url,
    ...(digests[dbName] ? { sha256: digests[dbName] } : {}),
    ...(Object.keys(pluginVersions).length > 0 ? { pluginVersions } : {}),
  };
  console.log(`  ${dbName}: ${url}`);
  if (digests[dbName]) console.log(`    sha256: ${digests[dbName]}`);
}

writeFileSync('eval/suites/retrieval-quality.json', JSON.stringify(suite, null, 2) + '\n');
console.log('\neval/suites/retrieval-quality.json updated.');
