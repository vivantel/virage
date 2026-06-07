import { readFile, writeFile } from "fs/promises";
import { existsSync } from "fs";
import { resolve } from "path";
import { input, confirm, select } from "@inquirer/prompts";
import {
  VirageDb,
  defaultVirageDb,
  TelemetryFlusher,
  DEFAULT_TELEMETRY_CONFIG,
  type TelemetryConfig,
} from "@vivantel/virage-core";

const CONFIG_FILE = "./virage.config.json";

async function readConfig(): Promise<Record<string, unknown>> {
  try {
    return JSON.parse(await readFile(CONFIG_FILE, "utf-8")) as Record<
      string,
      unknown
    >;
  } catch {
    return {};
  }
}

async function writeConfig(cfg: Record<string, unknown>): Promise<void> {
  await writeFile(CONFIG_FILE, JSON.stringify(cfg, null, 2) + "\n", "utf-8");
}

function getTelemetryConfig(cfg: Record<string, unknown>): TelemetryConfig {
  const t = cfg["telemetry"] as Partial<TelemetryConfig> | undefined;
  return {
    ...DEFAULT_TELEMETRY_CONFIG,
    ...t,
    tiers: {
      ...DEFAULT_TELEMETRY_CONFIG.tiers,
      ...(t?.tiers ?? {}),
      explicit_feedback: {
        ...DEFAULT_TELEMETRY_CONFIG.tiers.explicit_feedback,
        ...(t?.tiers?.explicit_feedback ?? {}),
      },
    },
    privacy: {
      ...DEFAULT_TELEMETRY_CONFIG.privacy,
      ...(t?.privacy ?? {}),
    },
  };
}

export async function runTelemetryStatus(): Promise<void> {
  const cfg = await readConfig();
  const tel = getTelemetryConfig(cfg);

  console.log("\n📊 Telemetry Status");
  console.log("─".repeat(40));
  console.log(`  Enabled     : ${tel.enabled ? "✅ yes" : "❌ no"}`);
  console.log(
    `  Tier 1      : ${tel.tiers.implicit ? "✅ on" : "❌ off"} (search quality signals)`,
  );
  console.log(
    `  Tier 2      : ${tel.tiers.explicit_feedback.enabled ? "✅ on" : "❌ off"} (rag_feedback tool)`,
  );
  if (tel.endpoint) {
    console.log(`  Endpoint    : ${tel.endpoint}`);
    // Quick health check
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      const res = await fetch(tel.endpoint, {
        method: "HEAD",
        signal: controller.signal,
      });
      clearTimeout(timer);
      console.log(`  Endpoint    : ${res.ok ? "✅ reachable" : "⚠️  returned " + String(res.status)}`);
    } catch {
      console.log("  Endpoint    : ⚠️  unreachable (5s timeout)");
    }
  } else {
    console.log("  Endpoint    : not configured (local-only)");
  }

  const dbPath = defaultVirageDb();
  if (existsSync(dbPath)) {
    try {
      const db = new VirageDb(dbPath);
      const bufferBytes = db.getTelemetryBufferSizeBytes();
      const unflushed = db.getUnflushedSessions().length;
      db.close();
      console.log(
        `  Buffer size : ~${(bufferBytes / 1024).toFixed(1)} KB`,
      );
      console.log(`  Unflushed   : ${unflushed} session(s)`);
    } catch {
      console.log("  Buffer size : (could not open DB)");
    }
  } else {
    console.log("  Buffer size : (no DB yet)");
  }
  console.log("─".repeat(40));
}

export async function runTelemetryOn(): Promise<void> {
  const cfg = await readConfig();
  const existing = (cfg["telemetry"] as Record<string, unknown>) ?? {};
  cfg["telemetry"] = { ...existing, enabled: true };
  await writeConfig(cfg);
  console.log("✅ Telemetry enabled. Run 'virage telemetry status' to verify.");
}

export async function runTelemetryOff(opts: {
  tiers?: string;
}): Promise<void> {
  const cfg = await readConfig();
  const existing = (cfg["telemetry"] as Record<string, unknown>) ?? {};

  if (opts.tiers === "explicit_feedback") {
    const tiers = (existing["tiers"] as Record<string, unknown>) ?? {};
    const ef = (tiers["explicit_feedback"] as Record<string, unknown>) ?? {};
    cfg["telemetry"] = {
      ...existing,
      tiers: {
        ...(tiers as object),
        explicit_feedback: { ...(ef as object), enabled: false },
      },
    };
    await writeConfig(cfg);
    console.log("✅ Tier 2 (rag_feedback) disabled.");
    return;
  }

  cfg["telemetry"] = { ...existing, enabled: false };
  await writeConfig(cfg);

  // Clear buffered telemetry
  const dbPath = defaultVirageDb();
  if (existsSync(dbPath)) {
    try {
      const db = new VirageDb(dbPath);
      db.clearTelemetryData();
      db.close();
      console.log("🗑️  Local telemetry buffer cleared.");
    } catch {
      console.warn("⚠️  Could not clear telemetry buffer (DB open elsewhere?)");
    }
  }
  console.log("✅ Telemetry disabled.");
}

export async function runTelemetryInit(): Promise<void> {
  const cfg = await readConfig();
  const existing = getTelemetryConfig(cfg);

  console.log("\n🔧 Telemetry setup\n");

  const endpoint = await input({
    message: "Telemetry endpoint URL (leave blank for local-only):",
    default: existing.endpoint ?? "",
  });

  let apiKey: string | undefined;
  if (endpoint.trim()) {
    apiKey = await input({
      message: "API key (or $ENV_VAR name, leave blank for none):",
      default: existing.api_key ?? "",
    });
  }

  const enableTier2 = await confirm({
    message: "Enable Tier 2 (rag_feedback tool, ~3% token budget)?",
    default: existing.tiers.explicit_feedback.enabled,
  });

  let samplingRate = existing.tiers.explicit_feedback.sampling_rate;
  if (enableTier2) {
    const rateStr = await select({
      message: "Feedback sampling rate:",
      choices: [
        { name: "10% of searches", value: "0.1" },
        { name: "20% of searches (default)", value: "0.2" },
        { name: "50% of searches", value: "0.5" },
      ],
      default: (String(samplingRate) as "0.1" | "0.2" | "0.5") || "0.2",
    });
    samplingRate = parseFloat(rateStr);
  }

  const updated: TelemetryConfig = {
    ...existing,
    enabled: true,
    endpoint: endpoint.trim() || undefined,
    api_key: apiKey?.trim() || undefined,
    tiers: {
      ...existing.tiers,
      explicit_feedback: {
        ...existing.tiers.explicit_feedback,
        enabled: enableTier2,
        sampling_rate: samplingRate,
      },
    },
  };

  cfg["telemetry"] = updated;
  await writeConfig(cfg);
  console.log(`\n✅ Telemetry configured in ${resolve(CONFIG_FILE)}`);

  if (enableTier2) {
    console.log(
      "\nℹ️  Tier 2 disclosure: Claude will call rag_feedback on " +
        `~${Math.round(samplingRate * 100)}% of searches.\n` +
        "   Always-on for anomalies (0 results or >10 results).\n" +
        `   Capped at 20 calls/session (~${updated.tiers.explicit_feedback.max_token_budget_percent}% of token budget).\n`,
    );
  }
}

export async function runTelemetryPreview(): Promise<void> {
  const dbPath = defaultVirageDb();
  if (!existsSync(dbPath)) {
    console.log("ℹ️  No virage.db found. Run the MCP server first.");
    return;
  }

  const cfg = await readConfig();
  const tel = getTelemetryConfig(cfg);

  const db = new VirageDb(dbPath);
  try {
    const unflushed = db.getUnflushedSessions();
    if (unflushed.length === 0) {
      console.log("ℹ️  No unflushed sessions to preview.");
      return;
    }
    const latest = unflushed[unflushed.length - 1];
    const flusher = new TelemetryFlusher(db, tel);
    const payload = flusher.buildSessionSummaryPayload(latest.id);
    console.log(JSON.stringify(payload, null, 2));
  } finally {
    db.close();
  }
}

export async function runTelemetryFlush(opts: {
  dryRun: boolean;
}): Promise<void> {
  if (opts.dryRun) {
    await runTelemetryPreview();
    return;
  }

  const dbPath = defaultVirageDb();
  if (!existsSync(dbPath)) {
    console.log("ℹ️  No virage.db found. Nothing to flush.");
    return;
  }

  const cfg = await readConfig();
  const tel = getTelemetryConfig(cfg);

  if (!tel.endpoint) {
    console.log("ℹ️  No endpoint configured. Use 'virage telemetry init' to set one.");
    return;
  }

  const db = new VirageDb(dbPath);
  try {
    const unflushed = db.getUnflushedSessions();
    if (unflushed.length === 0) {
      console.log("ℹ️  Nothing to flush.");
      return;
    }
    const flusher = new TelemetryFlusher(db, tel);
    let succeeded = 0;
    for (const session of unflushed) {
      const ok = await flusher.flush(session.id);
      if (ok) succeeded++;
    }
    console.log(`✅ Flushed ${succeeded}/${unflushed.length} session(s).`);
    if (succeeded < unflushed.length) {
      console.warn(
        `⚠️  ${unflushed.length - succeeded} session(s) failed — will retry on next MCP start.`,
      );
    }
  } finally {
    db.close();
  }
}
