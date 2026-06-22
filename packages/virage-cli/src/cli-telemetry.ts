import { readFile } from "fs/promises";
import {
  VirageDb,
  defaultVirageDb,
  TelemetrySession,
  TelemetryManager,
  DEFAULT_TELEMETRY_CONFIG,
  type TelemetryConfig,
} from "@vivantel/virage-core";

function parseTelemetryConfig(raw: Record<string, unknown>): TelemetryConfig {
  const t = raw["telemetry"] as Partial<TelemetryConfig> | undefined;
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

export class CliTelemetry {
  private session: TelemetrySession | null = null;
  private db: VirageDb | null = null;

  private constructor(
    private readonly config: TelemetryConfig,
    private readonly enabled: boolean,
  ) {}

  static async fromConfigPath(configPath: string): Promise<CliTelemetry> {
    try {
      const raw = JSON.parse(await readFile(configPath, "utf-8")) as Record<
        string,
        unknown
      >;
      const config = parseTelemetryConfig(raw);
      return new CliTelemetry(config, config.enabled && config.tiers.implicit);
    } catch {
      return new CliTelemetry(DEFAULT_TELEMETRY_CONFIG, false);
    }
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  start(): void {
    if (!this.enabled) return;
    try {
      this.db = new VirageDb(defaultVirageDb());
      const manager = new TelemetryManager(this.db, this.config);
      manager.printFirstRunDisclosure();
      this.session = manager.startSession({
        nodeVersion: process.version,
        os: process.platform,
      });
    } catch {
      this.session = null;
      this.db = null;
    }
  }

  record(command: string, durationMs: number, success: boolean): void {
    if (!this.session) return;
    try {
      this.session.recordCliCommand(command, durationMs, success);
      this.session.end();
    } catch {
      // telemetry must never crash the CLI
    } finally {
      try {
        this.db?.close();
      } catch {
        // ignore
      }
      this.session = null;
      this.db = null;
    }
  }
}
