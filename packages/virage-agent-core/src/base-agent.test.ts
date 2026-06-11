import { describe, it, expect } from "vitest";
import {
  BaseAgentPlugin,
  NORMALIZED_EVENTS,
  CLAUDE_VENDOR_CONFIG,
  COPILOT_VENDOR_CONFIG,
  CODEX_VENDOR_CONFIG,
  ANTIGRAVITY_VENDOR_CONFIG,
} from "./index.js";
import type {
  AgentConfigResult,
  VendorConfig,
  NormalizedEventName,
} from "./index.js";

class TestAgentPlugin extends BaseAgentPlugin {
  readonly name = "test";
  readonly label = "Test Agent";
  readonly vendorConfig: VendorConfig;

  constructor(config: VendorConfig) {
    super();
    this.vendorConfig = config;
  }

  async configure(): Promise<AgentConfigResult> {
    return { hooksWritten: false };
  }
}

describe("NORMALIZED_EVENTS", () => {
  it("contains all 33 events from the schema", () => {
    expect(NORMALIZED_EVENTS).toHaveLength(33);
  });

  it("includes core cross-vendor events", () => {
    const events: NormalizedEventName[] =
      NORMALIZED_EVENTS as unknown as NormalizedEventName[];
    expect(events).toContain("pre_tool_use");
    expect(events).toContain("post_tool_use");
    expect(events).toContain("agent_stop");
    expect(events).toContain("session_start");
  });
});

describe("CLAUDE_VENDOR_CONFIG", () => {
  it("has 30 supported events", () => {
    expect(CLAUDE_VENDOR_CONFIG.supportedEvents).toHaveLength(30);
  });

  it("every supported event is a valid NormalizedEventName", () => {
    for (const e of CLAUDE_VENDOR_CONFIG.supportedEvents) {
      expect(NORMALIZED_EVENTS).toContain(e);
    }
  });

  it("maps agent_stop to Stop", () => {
    expect(CLAUDE_VENDOR_CONFIG.eventNameMap.agent_stop).toBe("Stop");
  });

  it("maps unsupported events to null", () => {
    expect(CLAUDE_VENDOR_CONFIG.eventNameMap.pre_invocation).toBeNull();
    expect(CLAUDE_VENDOR_CONFIG.eventNameMap.error_occurred).toBeNull();
  });
});

describe("COPILOT_VENDOR_CONFIG", () => {
  it("has 12 supported events", () => {
    expect(COPILOT_VENDOR_CONFIG.supportedEvents).toHaveLength(12);
  });

  it("every supported event is a valid NormalizedEventName", () => {
    for (const e of COPILOT_VENDOR_CONFIG.supportedEvents) {
      expect(NORMALIZED_EVENTS).toContain(e);
    }
  });

  it("maps pre_tool_use to dual-name array", () => {
    expect(COPILOT_VENDOR_CONFIG.eventNameMap.pre_tool_use).toEqual([
      "preToolUse",
      "PreToolUse",
    ]);
  });

  it("does not support claude-only events", () => {
    expect(COPILOT_VENDOR_CONFIG.supportedEvents).not.toContain(
      "instructions_loaded",
    );
    expect(COPILOT_VENDOR_CONFIG.supportedEvents).not.toContain(
      "pre_invocation",
    );
  });
});

describe("CODEX_VENDOR_CONFIG", () => {
  it("has 10 supported events", () => {
    expect(CODEX_VENDOR_CONFIG.supportedEvents).toHaveLength(10);
  });

  it("every supported event is a valid NormalizedEventName", () => {
    for (const e of CODEX_VENDOR_CONFIG.supportedEvents) {
      expect(NORMALIZED_EVENTS).toContain(e);
    }
  });

  it("supports only command hook type", () => {
    expect(CODEX_VENDOR_CONFIG.hookTypes).toEqual(["command"]);
  });
});

describe("ANTIGRAVITY_VENDOR_CONFIG", () => {
  it("has 5 supported events", () => {
    expect(ANTIGRAVITY_VENDOR_CONFIG.supportedEvents).toHaveLength(5);
  });

  it("supports pre_invocation and post_invocation", () => {
    expect(ANTIGRAVITY_VENDOR_CONFIG.supportedEvents).toContain(
      "pre_invocation",
    );
    expect(ANTIGRAVITY_VENDOR_CONFIG.supportedEvents).toContain(
      "post_invocation",
    );
  });

  it("every supported event is a valid NormalizedEventName", () => {
    for (const e of ANTIGRAVITY_VENDOR_CONFIG.supportedEvents) {
      expect(NORMALIZED_EVENTS).toContain(e);
    }
  });
});

describe("BaseAgentPlugin", () => {
  describe("with CLAUDE_VENDOR_CONFIG", () => {
    const plugin = new TestAgentPlugin(CLAUDE_VENDOR_CONFIG);

    it("vendor getter returns claude", () => {
      expect(plugin.vendor).toBe("claude");
    });

    it("supportsEvent returns true for supported events", () => {
      expect(plugin.supportsEvent("pre_tool_use")).toBe(true);
      expect(plugin.supportsEvent("session_start")).toBe(true);
      expect(plugin.supportsEvent("teammate_idle")).toBe(true);
    });

    it("supportsEvent returns false for unsupported events", () => {
      expect(plugin.supportsEvent("pre_invocation")).toBe(false);
      expect(plugin.supportsEvent("error_occurred")).toBe(false);
    });

    it("getVendorEventName returns correct string for simple mapping", () => {
      expect(plugin.getVendorEventName("pre_tool_use")).toBe("PreToolUse");
      expect(plugin.getVendorEventName("agent_stop")).toBe("Stop");
    });

    it("getVendorEventName returns null for unmapped events", () => {
      expect(plugin.getVendorEventName("pre_invocation")).toBeNull();
    });

    it("getPrimaryEventName returns the string value", () => {
      expect(plugin.getPrimaryEventName("pre_tool_use")).toBe("PreToolUse");
    });

    it("getPrimaryEventName returns null for unmapped events", () => {
      expect(plugin.getPrimaryEventName("pre_invocation")).toBeNull();
    });
  });

  describe("with COPILOT_VENDOR_CONFIG", () => {
    const plugin = new TestAgentPlugin(COPILOT_VENDOR_CONFIG);

    it("vendor getter returns copilot", () => {
      expect(plugin.vendor).toBe("copilot");
    });

    it("getVendorEventName returns array for dual-name events", () => {
      const result = plugin.getVendorEventName("pre_tool_use");
      expect(Array.isArray(result)).toBe(true);
      expect(result).toEqual(["preToolUse", "PreToolUse"]);
    });

    it("getPrimaryEventName returns first element of array", () => {
      expect(plugin.getPrimaryEventName("pre_tool_use")).toBe("preToolUse");
      expect(plugin.getPrimaryEventName("agent_stop")).toBe("agentStop");
    });

    it("supportsEvent returns false for antigravity-only events", () => {
      expect(plugin.supportsEvent("pre_invocation")).toBe(false);
    });
  });

  describe("with ANTIGRAVITY_VENDOR_CONFIG", () => {
    const plugin = new TestAgentPlugin(ANTIGRAVITY_VENDOR_CONFIG);

    it("vendor getter returns antigravity", () => {
      expect(plugin.vendor).toBe("antigravity");
    });

    it("supportsEvent returns true for pre_invocation", () => {
      expect(plugin.supportsEvent("pre_invocation")).toBe(true);
      expect(plugin.supportsEvent("post_invocation")).toBe(true);
    });

    it("supportsEvent returns false for claude-only events", () => {
      expect(plugin.supportsEvent("session_start")).toBe(false);
      expect(plugin.supportsEvent("instructions_loaded")).toBe(false);
    });

    it("getPrimaryEventName returns correct mapping", () => {
      expect(plugin.getPrimaryEventName("pre_invocation")).toBe(
        "PreInvocation",
      );
      expect(plugin.getPrimaryEventName("agent_stop")).toBe("Stop");
    });

    it("getPrimaryEventName returns null for unsupported events", () => {
      expect(plugin.getPrimaryEventName("session_start")).toBeNull();
    });
  });
});
