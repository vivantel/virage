import { execSync } from "child_process";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
console.log("REPO_ROOT:", REPO_ROOT);
console.log("process.env.PATH:", process.env.PATH);

try {
  const which = execSync("which virage", { encoding: "utf-8", cwd: REPO_ROOT });
  console.log("which virage (cwd=REPO_ROOT):", which);
} catch (e: any) {
  console.log("which virage FAILED:", e.message);
}

try {
  const out = execSync(
    `virage query "configure chunker package include ignore patterns ADR" --top-k 5 --json --config virage.config.ci.json`,
    { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"], cwd: REPO_ROOT },
  );
  console.log("SUCCESS, length:", out.length);
} catch (e: any) {
  console.log("FAILED. stderr:", e.stderr);
}
