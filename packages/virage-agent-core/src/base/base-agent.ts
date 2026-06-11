import type { NormalizedEventName } from "../types/events.js";
import type { AgentConfigResult } from "../types/result.js";
import type { VendorConfig, VendorName } from "../types/vendor.js";

export abstract class BaseAgentPlugin {
  abstract readonly name: string;
  abstract readonly label: string;
  abstract readonly vendorConfig: VendorConfig;

  abstract configure(projectRoot: string): Promise<AgentConfigResult>;

  get vendor(): VendorName {
    return this.vendorConfig.vendor;
  }

  getVendorEventName(event: NormalizedEventName): string | string[] | null {
    return this.vendorConfig.eventNameMap[event] ?? null;
  }

  getPrimaryEventName(event: NormalizedEventName): string | null {
    const mapped = this.getVendorEventName(event);
    if (mapped == null) return null;
    return Array.isArray(mapped) ? mapped[0] : mapped;
  }

  supportsEvent(event: NormalizedEventName): boolean {
    return (
      this.vendorConfig.supportedEvents as ReadonlyArray<NormalizedEventName>
    ).includes(event);
  }
}
