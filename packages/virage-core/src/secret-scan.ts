/**
 * Pre-index secret scan (retrieval contract v0, `preIndexSecretScan`).
 *
 * Text is scanned before it is embedded; a file with a finding is skipped. The
 * scan is a set of high-signal token shapes (private-key blocks, cloud and VCS
 * tokens, JWTs) plus a high-entropy value assigned to a secret-looking name.
 * A finding names a *kind* only: the matched text is never returned or logged.
 *
 * Mirrors `crates/virage-engine/src/secret_scan.rs`.
 */

export interface SecretFinding {
  kind: string;
}

const B = "(?<![A-Za-z0-9])"; // token must start a word, not sit inside an identifier

const TOKEN_RULES: Array<[string, RegExp]> = [
  ["private-key", /-----BEGIN [A-Z ]{0,40}PRIVATE KEY-----/],
  ["aws-access-key", new RegExp(`${B}(?:AKIA|ASIA)[A-Z0-9]{16}(?![A-Z0-9])`)],
  [
    "github-token",
    new RegExp(
      `${B}(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_-]{22,})`,
    ),
  ],
  ["slack-token", new RegExp(`${B}xox[bparsa]-[A-Za-z0-9-]{20,}`)],
  ["google-api-key", new RegExp(`${B}AIza[A-Za-z0-9_-]{35}(?![A-Za-z0-9_-])`)],
  ["stripe-key", new RegExp(`${B}[sr]k_live_[A-Za-z0-9]{24,}`)],
  ["api-key", new RegExp(`${B}sk-[A-Za-z0-9_-]{32,}`)],
  [
    "jwt",
    new RegExp(
      `${B}eyJ[A-Za-z0-9_-]{8,}\\.eyJ[A-Za-z0-9_-]{8,}\\.[A-Za-z0-9_-]{8,}`,
    ),
  ],
];

const ASSIGNMENT =
  /(?:password|passwd|secret|token|api_key|apikey|api-key|private_key|access_key)[A-Za-z0-9_]*["']?[ \t]*[:=]=?[ \t]*(["'])([A-Za-z0-9+/=_.~!@#$%^&*-]{16,})\1/gi;

/** Substrings that mark a value as an obvious placeholder, not a credential. */
const PLACEHOLDERS = [
  "example",
  "your",
  "placeholder",
  "changeme",
  "change-me",
  "xxxx",
  "****",
  "dummy",
  "sample",
  "redacted",
  "todo",
  "fixme",
  "${",
  "{{",
  "<",
  ">",
  "process.env",
  "getenv",
  "secret_key_here",
];

/** Shannon entropy in bits per character. */
function entropy(s: string): number {
  const counts = new Map<string, number>();
  for (const ch of s) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  let h = 0;
  for (const c of counts.values()) {
    const p = c / s.length;
    h -= p * Math.log2(p);
  }
  return h;
}

/** Scan text. Returns the first finding, if any. */
export function scanForSecrets(text: string): SecretFinding | null {
  for (const [kind, re] of TOKEN_RULES) {
    if (re.test(text)) return { kind };
  }
  for (const m of text.matchAll(ASSIGNMENT)) {
    const value = m[2] ?? "";
    const lowered = value.toLowerCase();
    if (PLACEHOLDERS.some((p) => lowered.includes(p))) continue;
    if (entropy(value) >= 3.5) return { kind: "credential-assignment" };
  }
  return null;
}

/** First finding in any of the given texts. */
export function scanChunksForSecrets(
  chunks: Array<{ denseText: string; sparseText?: string }>,
): SecretFinding | null {
  for (const c of chunks) {
    const f =
      scanForSecrets(c.denseText) ??
      (c.sparseText ? scanForSecrets(c.sparseText) : null);
    if (f) return f;
  }
  return null;
}
