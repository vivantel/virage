import { readFile } from "fs/promises";
import { join } from "path";

interface AsstEntry {
  type: "assistant";
  timestamp: string;
  requestId?: string;
  message: {
    usage?: {
      input_tokens: number;
      output_tokens: number;
      cache_read_input_tokens: number;
      cache_creation_input_tokens: number;
    };
  };
}

interface UserEntry {
  type: "user";
  timestamp?: string;
  isMeta?: boolean;
  message: { content?: string | Array<{ type: string; text?: string }> };
}

type Entry = AsstEntry | UserEntry | Record<string, unknown>;

function isToolResult(c: unknown): boolean {
  return (
    Array.isArray(c) &&
    c.length > 0 &&
    c.every(
      (b) =>
        typeof b === "object" &&
        b !== null &&
        (b as { type: string }).type === "tool_result",
    )
  );
}

function toText(c: unknown): string {
  if (typeof c === "string")
    return c
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  if (Array.isArray(c))
    return c
      .filter((b) => (b as { type: string }).type === "text")
      .map((b) => (b as { text?: string }).text ?? "")
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
  return "";
}

// Column widths sized to fit locale-formatted numbers up to ~9.9M tokens
const W = 120;
const C = { inp: 10, crd: 10, ccr: 9, out: 8, tot: 10 };

function fmtRow(
  idx: string | number,
  time: string,
  prompt: string,
  inp: number,
  crd: number,
  ccr: number,
  out: number,
  tot: number,
): string {
  return (
    `${String(idx).padStart(4)} ${time.padEnd(10)} ${prompt.padEnd(52)}` +
    ` ${inp.toLocaleString().padStart(C.inp)}` +
    ` ${crd.toLocaleString().padStart(C.crd)}` +
    ` ${ccr.toLocaleString().padStart(C.ccr)}` +
    ` ${out.toLocaleString().padStart(C.out)}` +
    ` ${tot.toLocaleString().padStart(C.tot)}`
  );
}

export async function buildSessionUsage(
  sessionId: string,
  configDir: string,
  pwd: string,
): Promise<string> {
  if (!sessionId || !configDir || !pwd) {
    return "Error: Missing CLAUDE_CODE_SESSION_ID, CLAUDE_CONFIG_DIR, or PWD";
  }

  const slug = pwd.replace(/\//g, "-");
  const logPath = join(configDir, "projects", slug, `${sessionId}.jsonl`);

  let raw: string;
  try {
    raw = await readFile(logPath, "utf-8");
  } catch {
    return `Session log not found: ${logPath}`;
  }

  const entries: Entry[] = raw
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Entry);

  const starters = entries.filter(
    (e): e is UserEntry =>
      (e as UserEntry).type === "user" &&
      !(e as UserEntry).isMeta &&
      !!(e as UserEntry).timestamp &&
      !isToolResult((e as UserEntry).message?.content),
  );

  const seen = new Set<string>();
  const asst = entries.filter((e): e is AsstEntry => {
    const a = e as AsstEntry;
    if (a.type !== "assistant" || !a.message?.usage || !a.timestamp)
      return false;
    if (a.requestId) {
      if (seen.has(a.requestId)) return false;
      seen.add(a.requestId);
    }
    return true;
  });

  const sTs = starters.map((e) => ({ t: new Date(e.timestamp!), e }));
  const aTs = asst.map((e) => ({ t: new Date(e.timestamp), e }));

  const lines: string[] = [];
  lines.push(`Session: ${sessionId}`);
  lines.push(`Log:     ${logPath}`);
  lines.push("");
  lines.push(
    `${"#".padStart(4)} ${"Time".padEnd(10)} ${"Prompt".padEnd(52)}` +
      ` ${"Input".padStart(C.inp)}` +
      ` ${"CacheRd".padStart(C.crd)}` +
      ` ${"CacheCr".padStart(C.ccr)}` +
      ` ${"Output".padStart(C.out)}` +
      ` ${"Total".padStart(C.tot)}`,
  );
  lines.push("-".repeat(W));

  let gIn = 0,
    gCr = 0,
    gCc = 0,
    gOut = 0;

  for (let i = 0; i < sTs.length; i++) {
    const { t: ut, e: ue } = sTs[i]!;
    const nxt = sTs[i + 1]?.t;
    const win = aTs
      .filter(({ t }) => t >= ut && (!nxt || t < nxt))
      .map(({ e }) => e);
    const txt = toText(ue.message?.content);
    const lbl = txt.length > 52 ? txt.slice(0, 50) + ".." : txt;
    const u = { i: 0, cr: 0, cc: 0, o: 0 };
    for (const ae of win) {
      const us = ae.message.usage!;
      u.i += us.input_tokens;
      u.cr += us.cache_read_input_tokens;
      u.cc += us.cache_creation_input_tokens;
      u.o += us.output_tokens;
    }
    const tot = u.i + u.cr + u.cc + u.o;
    gIn += u.i;
    gCr += u.cr;
    gCc += u.cc;
    gOut += u.o;
    const ts = ut.toISOString().slice(11, 19);
    lines.push(fmtRow(i + 1, ts, lbl, u.i, u.cr, u.cc, u.o, tot));
  }

  lines.push("-".repeat(W));
  const gTot = gIn + gCr + gCc + gOut;
  lines.push(
    `${"TOTALS".padEnd(68)}` +
      ` ${gIn.toLocaleString().padStart(C.inp)}` +
      ` ${gCr.toLocaleString().padStart(C.crd)}` +
      ` ${gCc.toLocaleString().padStart(C.ccr)}` +
      ` ${gOut.toLocaleString().padStart(C.out)}` +
      ` ${gTot.toLocaleString().padStart(C.tot)}`,
  );
  lines.push("");
  lines.push(
    "Legend: Input = new input tokens | CacheRd = prompt cache read | CacheCr = prompt cache write | Output = generated tokens",
  );

  return lines.join("\n");
}
