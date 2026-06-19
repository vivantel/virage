import type { SourceRepository } from "@vivantel/virage-core";
import { IsomorphicGitSourceRepository } from "./isomorphic-git-source-repo.js";

export { IsomorphicGitSourceRepository };

export function createSourceRepository(
  config: Record<string, unknown>,
): SourceRepository {
  const dir = typeof config.dir === "string" ? config.dir : process.cwd();
  return new IsomorphicGitSourceRepository(dir);
}
