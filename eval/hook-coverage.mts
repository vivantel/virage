#!/usr/bin/env tsx
/**
 * Tests what fraction of grep/find bash commands are caught by the
 * Virage PreToolUse hook matchers — old set vs new set.
 *
 * Matcher semantics: Bash(<prefix>*) matches any command starting with <prefix>.
 * We simulate this with simple startsWith checks.
 */

// What was in the hook before this PR (grep -r* catches -rn/-rl/-rE by prefix; find . was also already present)
const OLD_MATCHERS = ["grep -r", "find ."];

// What is in the hook after this PR (grep -E* added for non-recursive extended-regex searches)
const NEW_MATCHERS = ["grep -r", "grep -E", "find ."];

interface SampleCommand {
  command: string;
  description: string;
}

const SAMPLE_COMMANDS: SampleCommand[] = [
  // grep -r variants
  { command: "grep -r 'EmbeddingProvider' .", description: "grep -r (basic)" },
  { command: "grep -r 'interface' packages/", description: "grep -r with path" },
  { command: "grep -rn 'buildSessionUsage' .", description: "grep -rn (line numbers)" },
  { command: "grep -rn 'TODO' packages/", description: "grep -rn with path" },
  { command: "grep -rl 'VectorStore' .", description: "grep -rl (list files)" },
  { command: "grep -rl 'export' packages/", description: "grep -rl with path" },
  { command: "grep -rE '(interface|type) \\w+' .", description: "grep -rE (extended regex)" },
  { command: "grep -rE 'import.*from' packages/", description: "grep -rE with path" },
  { command: "grep -E 'function|class' src/index.ts", description: "grep -E (single file)" },
  { command: "grep -E '^export' packages/virage-core/src/index.ts", description: "grep -E anchored" },
  // find variants
  { command: "find . -name '*.ts'", description: "find . -name" },
  { command: "find . -type f -newer package.json", description: "find . -newer" },
  // non-intercepted patterns (expected to escape both sets)
  { command: "grep -i 'pattern' file.txt", description: "grep -i (case insensitive, single file)" },
  { command: "grep -c 'match' file.ts", description: "grep -c (count)" },
  { command: "grep 'pattern' file.ts", description: "grep (no flags)" },
  { command: "find /tmp -name '*.log'", description: "find /tmp (non-project root)" },
  { command: "ls -la packages/", description: "ls (unrelated)" },
  { command: "cat packages/virage-core/src/index.ts", description: "cat (unrelated)" },
  { command: "npm run build", description: "npm run (unrelated)" },
  { command: "git log --oneline", description: "git log (unrelated)" },
];

function matchesAny(command: string, matchers: string[]): boolean {
  return matchers.some((m) => command.startsWith(m));
}

function run(summaryMode = false): void {
  const results = SAMPLE_COMMANDS.map((s) => ({
    ...s,
    oldCaught: matchesAny(s.command, OLD_MATCHERS),
    newCaught: matchesAny(s.command, NEW_MATCHERS),
  }));

  const oldCaught = results.filter((r) => r.oldCaught).length;
  const newCaught = results.filter((r) => r.newCaught).length;
  const total = results.length;
  const oldPct = ((oldCaught / total) * 100).toFixed(1);
  const newPct = ((newCaught / total) * 100).toFixed(1);
  const newlyIntercepted = results.filter((r) => r.newCaught && !r.oldCaught);

  if (summaryMode) {
    console.log("### Hook Coverage");
    console.log("");
    console.log(`| Metric | Value |`);
    console.log(`|---|---|`);
    console.log(`| Sample commands | ${total} |`);
    console.log(`| Old coverage (grep -r only) | ${oldCaught}/${total} (${oldPct}%) |`);
    console.log(`| New coverage (all variants) | ${newCaught}/${total} (${newPct}%) |`);
    console.log(`| Newly intercepted | ${newlyIntercepted.length} |`);
    console.log("");
    if (newlyIntercepted.length > 0) {
      console.log("**Newly intercepted commands:**");
      console.log("");
      for (const r of newlyIntercepted) {
        console.log(`- \`${r.command}\` — ${r.description}`);
      }
    }
  } else {
    console.log("Hook Coverage Report");
    console.log("=".repeat(60));
    console.log(`Sample size:      ${total} commands`);
    console.log(`Old coverage:     ${oldCaught}/${total} = ${oldPct}%  (grep -r only)`);
    console.log(`New coverage:     ${newCaught}/${total} = ${newPct}%  (all variants + find)`);
    console.log(`Delta:            +${newlyIntercepted.length} commands now intercepted`);
    console.log("");
    console.log("Newly intercepted:");
    for (const r of newlyIntercepted) {
      console.log(`  ✓  ${r.command.padEnd(45)} ${r.description}`);
    }
    console.log("");
    const escaped = results.filter((r) => !r.newCaught);
    console.log(`Still escaping (${escaped.length}):`);
    for (const r of escaped) {
      console.log(`  ·  ${r.command.padEnd(45)} ${r.description}`);
    }
  }
}

const summaryFlag = process.argv.includes("--summary");
run(summaryFlag);
