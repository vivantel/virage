#!/usr/bin/env node
import { createRequire } from "module";
import { spawnSync } from "child_process";

const require = createRequire(import.meta.url);

const PLATFORMS = {
  "linux-x64":   "@vivantel/virage-linux-x64-gnu/virage",
  "linux-arm64": "@vivantel/virage-linux-arm64-gnu/virage",
  "darwin-arm64": "@vivantel/virage-darwin-arm64/virage",
  "win32-x64":   "@vivantel/virage-win32-x64-msvc/virage.exe",
};

const key = `${process.platform}-${process.arch}`;
const pkg = PLATFORMS[key];

if (!pkg) {
  process.stderr.write(
    `\x1b[31merror\x1b[0m: @vivantel/virage has no prebuilt binary for platform "${key}".\n` +
    `Supported: ${Object.keys(PLATFORMS).join(", ")}\n`
  );
  process.exit(1);
}

let bin;
try {
  bin = require.resolve(pkg);
} catch {
  process.stderr.write(
    `\x1b[31merror\x1b[0m: Could not find binary for "${key}".\n` +
    `Run: npm install @vivantel/virage (or reinstall with --include=optional)\n`
  );
  process.exit(1);
}

const { status } = spawnSync(bin, process.argv.slice(2), { stdio: "inherit" });
process.exit(status ?? 1);
