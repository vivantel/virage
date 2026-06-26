'use strict';
// Ensures every platform-stub entry in package-lock.json has a "version" field that
// matches the optionalDependency pin in the owning package's package.json.
//
// Why this is needed: when npm installs the workspace after a version bump but before
// the new stubs are published, it writes {"optional":true} with no version field.
// npm's arborist then throws "Invalid Version" on the next npm ci because it calls
// new SemVer(node.version) on all nodes during ideal-tree reconstruction.
//
// Stubs may appear at either a nested path (packages/X/node_modules/@vivantel/Y) or a
// hoisted path (node_modules/@vivantel/Y) depending on npm's deduplication. Both are
// patched. Hoisted stubs retain their original resolved/integrity (pointing to the
// last-published tarball) so npm ci can install that tarball while the new version is
// still in the release pipeline.
//
// Run automatically via the root postinstall hook (npm install) and as an explicit
// CI step before npm ci.

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const lockfilePath = path.join(root, 'package-lock.json');
const lock = JSON.parse(fs.readFileSync(lockfilePath, 'utf8'));
const packages = lock.packages ?? {};

let changed = false;

for (const [pkgPath, pkgEntry] of Object.entries(packages)) {
  if (!pkgPath.startsWith('packages/') || pkgPath.includes('node_modules')) continue;

  const pkgJsonPath = path.join(root, pkgPath, 'package.json');
  if (!fs.existsSync(pkgJsonPath)) continue;

  const { optionalDependencies: optDeps = {} } = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));

  for (const [depName, depVersion] of Object.entries(optDeps)) {
    if (!depName.startsWith('@vivantel/')) continue;

    if (pkgEntry.optionalDependencies?.[depName] !== undefined &&
        pkgEntry.optionalDependencies[depName] !== depVersion) {
      pkgEntry.optionalDependencies[depName] = depVersion;
      changed = true;
    }

    const stubPath = `${pkgPath}/node_modules/${depName}`;
    const stubEntry = packages[stubPath];
    if (stubEntry !== undefined && stubEntry.version !== depVersion) {
      stubEntry.version = depVersion;
      changed = true;
    }

    const hoistedPath = `node_modules/${depName}`;
    const hoistedEntry = packages[hoistedPath];
    if (hoistedEntry !== undefined && hoistedEntry.version !== depVersion) {
      hoistedEntry.version = depVersion;
      changed = true;
    }
  }
}

if (changed) {
  fs.writeFileSync(lockfilePath, JSON.stringify(lock, null, 2) + '\n');
  console.log('patch-lockfile-stubs: synced platform stub version fields in package-lock.json');
}
