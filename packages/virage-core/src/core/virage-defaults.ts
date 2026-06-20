import { homedir } from "node:os";
import { join } from "node:path";

export const IGNORED_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "coverage",
  ".cache",
  ".next",
  "out",
  ".turbo",
]);

export const DEFAULT_EXCLUDE_PATTERNS: string[] = [
  // Minified assets
  "**/*.min.js",
  "**/*.min.css",
  // Lock files
  "**/*.lock",
  "**/package-lock.json",
  "**/yarn.lock",
  "**/pnpm-lock.yaml",
  // Vendored code
  "**/vendor/**",
  // Node.js / JS frameworks
  "**/node_modules/**",
  "**/.turbo/**",
  "**/.next/**",
  "**/dist/**",
  "**/out/**",
  // .NET
  "**/bin/**",
  "**/obj/**",
  "**/*.generated.cs",
  // Java / Maven
  "**/target/**",
  "**/*.class",
  // C / C++
  "**/CMakeFiles/**",
  "**/cmake-build-*/**",
  "**/*.o",
  "**/*.a",
  // Generated protobuf
  "**/*.pb.ts",
  "**/*.pb.go",
  "**/*.pb.cs",
];

export function getVirageDir(): string {
  return process.env["VIRAGE_DIR"] ?? ".virage";
}

export function getGlobalVirageDir(): string {
  return process.env["VIRAGE_GLOBAL_DIR"] ?? join(homedir(), ".virage");
}

export function defaultVirageDb(): string {
  return `${getVirageDir()}/virage.db`;
}
