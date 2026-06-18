import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { PrimeReactProvider } from "primereact/api";
import { AnalyticsPage } from "../AnalyticsPage";

vi.mock("../../api/client", () => ({
  api: {
    analytics: {
      stats: vi.fn(),
      perHour: vi.fn(),
      topTerms: vi.fn(),
      zeroResults: vi.fn(),
    },
  },
}));

import { api } from "../../api/client";

const mockStats = {
  queriesLastHour: 12,
  queriesLast24h: 88,
  avgTopSimilarity: 0.731,
  zeroResultRate: 0.045,
};

const mockPerHour = {
  buckets: [
    { hour: "2026-06-17T10:00:00Z", count: 5 },
    { hour: "2026-06-17T11:00:00Z", count: 7 },
  ],
};

const mockTerms = {
  terms: [
    { query_text: "auth flow", count: 15 },
    { query_text: "session expiry", count: 9 },
  ],
};

const mockZeroResults = {
  queries: [
    {
      id: "q1",
      occurred_at: new Date(Date.now() - 60_000).toISOString(),
      query_text: "xyzzy plugh",
      query_hash: "abc",
      result_count: 1,
      top_similarity: 0.21,
      was_empty: 0,
      hybrid_used: 0,
      reranked: 0,
    },
  ],
};

function setup() {
  vi.mocked(api.analytics.stats).mockResolvedValue(mockStats);
  vi.mocked(api.analytics.perHour).mockResolvedValue(mockPerHour);
  vi.mocked(api.analytics.topTerms).mockResolvedValue(mockTerms);
  vi.mocked(api.analytics.zeroResults).mockResolvedValue(mockZeroResults);
}

function renderPage() {
  return render(
    <PrimeReactProvider>
      <AnalyticsPage />
    </PrimeReactProvider>,
  );
}

describe("AnalyticsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders Search Activity heading", async () => {
    setup();
    renderPage();
    await waitFor(() => expect(screen.getByText("Search Activity")).toBeTruthy());
  });

  it("displays stat cards with correct values", async () => {
    setup();
    renderPage();
    await waitFor(() => expect(screen.getByText("12")).toBeTruthy());
    expect(screen.getByText("88")).toBeTruthy();
    expect(screen.getByText("0.731")).toBeTruthy();
    expect(screen.getByText("4.5%")).toBeTruthy();
  });

  it("renders top search terms", async () => {
    setup();
    renderPage();
    await waitFor(() => expect(screen.getByText("auth flow")).toBeTruthy());
    expect(screen.getByText("session expiry")).toBeTruthy();
    expect(screen.getByText("15")).toBeTruthy();
  });

  it("renders low-quality queries table", async () => {
    setup();
    renderPage();
    await waitFor(() => expect(screen.getByText("xyzzy plugh")).toBeTruthy());
    expect(screen.getByText("0.210")).toBeTruthy();
  });

  it("shows Queries per Hour section", async () => {
    setup();
    renderPage();
    await waitFor(() => expect(screen.getByText("Queries per Hour (last 24 h)")).toBeTruthy());
  });

  it("shows error when API fails", async () => {
    vi.mocked(api.analytics.stats).mockRejectedValue(new Error("Analytics unavailable"));
    vi.mocked(api.analytics.perHour).mockRejectedValue(new Error("Analytics unavailable"));
    vi.mocked(api.analytics.topTerms).mockRejectedValue(new Error("Analytics unavailable"));
    vi.mocked(api.analytics.zeroResults).mockRejectedValue(new Error("Analytics unavailable"));
    renderPage();
    await waitFor(() => expect(screen.getByText(/Analytics unavailable/)).toBeTruthy());
  });

  it("shows empty messages when no data", async () => {
    vi.mocked(api.analytics.stats).mockResolvedValue({
      queriesLastHour: 0, queriesLast24h: 0, avgTopSimilarity: 0, zeroResultRate: 0,
    });
    vi.mocked(api.analytics.perHour).mockResolvedValue({ buckets: [] });
    vi.mocked(api.analytics.topTerms).mockResolvedValue({ terms: [] });
    vi.mocked(api.analytics.zeroResults).mockResolvedValue({ queries: [] });
    renderPage();
    await waitFor(() => expect(screen.getByText(/No data yet/i)).toBeTruthy());
    expect(screen.getByText(/No searches recorded yet/i)).toBeTruthy();
    expect(screen.getByText(/No low-quality queries/i)).toBeTruthy();
  });
});
