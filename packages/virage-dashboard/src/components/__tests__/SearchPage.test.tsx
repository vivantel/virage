import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PrimeReactProvider } from "primereact/api";
import { SearchPage } from "../SearchPage";

// Virtuoso relies on real browser scroll metrics — render items directly in tests
vi.mock("react-virtuoso", () => ({
  Virtuoso: ({
    data,
    itemContent,
  }: {
    data: unknown[];
    itemContent: (i: number, item: unknown) => React.ReactNode;
  }) => <>{data.map((item, i) => itemContent(i, item))}</>,
}));

vi.mock("../../api/client", () => ({
  api: {
    search: vi.fn(),
  },
}));

const mockShowError = vi.fn();
vi.mock("../../context/ToastContext", () => ({
  useToast: () => ({ showError: mockShowError, showSuccess: vi.fn() }),
}));

import { api } from "../../api/client";

function renderPage() {
  return render(
    <PrimeReactProvider>
      <SearchPage />
    </PrimeReactProvider>,
  );
}

describe("SearchPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders search input and button", () => {
    renderPage();
    expect(screen.getByPlaceholderText(/search query/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /search/i })).toBeTruthy();
  });

  it("search button is disabled when input is empty", () => {
    renderPage();
    const btn = screen.getByRole("button", { name: /search/i });
    expect(btn).toBeDisabled();
  });

  it("calls api.search on form submit", async () => {
    vi.mocked(api.search).mockResolvedValue({ results: [] });
    const user = userEvent.setup();
    renderPage();
    await user.type(
      screen.getByPlaceholderText(/search query/i),
      "how does auth work",
    );
    await user.click(screen.getByRole("button", { name: /search/i }));
    await waitFor(() =>
      expect(api.search).toHaveBeenCalledWith("how does auth work", 5),
    );
  });

  it("displays search results with similarity scores", async () => {
    vi.mocked(api.search).mockResolvedValue({
      results: [
        {
          id: "r1",
          denseText: "Auth uses JWT tokens.",
          sparseText: "auth jwt tokens",
          metadata: {},
          similarity: 0.92,
          sourceFile: "src/auth.ts",
        },
        {
          id: "r2",
          denseText: "Session expires after 1h.",
          sparseText: "session expires",
          metadata: {},
          similarity: 0.78,
          sourceFile: "src/session.ts",
        },
      ],
    });
    const user = userEvent.setup();
    renderPage();
    await user.type(screen.getByPlaceholderText(/search query/i), "auth");
    await user.click(screen.getByRole("button", { name: /search/i }));
    await waitFor(() =>
      expect(screen.getByText("Auth uses JWT tokens.")).toBeTruthy(),
    );
    expect(screen.getByText("92.0% match")).toBeTruthy();
    expect(screen.getByText("Session expires after 1h.")).toBeTruthy();
    expect(screen.getByText("78.0% match")).toBeTruthy();
  });

  it("shows empty-results message when no results returned", async () => {
    vi.mocked(api.search).mockResolvedValue({ results: [] });
    const user = userEvent.setup();
    renderPage();
    await user.type(screen.getByPlaceholderText(/search query/i), "xyzzy");
    await user.click(screen.getByRole("button", { name: /search/i }));
    await waitFor(() =>
      expect(screen.getByText(/No results found/i)).toBeTruthy(),
    );
  });

  it("shows error when api.search rejects", async () => {
    vi.mocked(api.search).mockRejectedValue(new Error("Search failed"));
    const user = userEvent.setup();
    renderPage();
    await user.type(
      screen.getByPlaceholderText(/search query/i),
      "error query",
    );
    await user.click(screen.getByRole("button", { name: /search/i }));
    await waitFor(() =>
      expect(mockShowError).toHaveBeenCalledWith(
        "Search failed",
        "Search failed",
      ),
    );
  });

  it("displays source file badge in results", async () => {
    vi.mocked(api.search).mockResolvedValue({
      results: [
        {
          id: "r1",
          denseText: "Content.",
          sparseText: "",
          metadata: {},
          similarity: 0.85,
          sourceFile: "src/router.ts",
        },
      ],
    });
    const user = userEvent.setup();
    renderPage();
    await user.type(screen.getByPlaceholderText(/search query/i), "routing");
    await user.click(screen.getByRole("button", { name: /search/i }));
    await waitFor(() => expect(screen.getByText("src/router.ts")).toBeTruthy());
  });

  it("expands result card to show sparseText, metadata, and generator IDs", async () => {
    vi.mocked(api.search).mockResolvedValue({
      results: [
        {
          id: "chunk-99",
          denseText: "Authentication via OAuth2.",
          sparseText: "authentication oauth2 tokens scopes",
          metadata: { framework: "express", version: "4" },
          similarity: 0.91,
          sourceFile: "src/auth/oauth.ts",
          sparseTextGeneratorId: "bm25-v3",
          metadataGeneratorId: "meta-extractor-v2",
        },
      ],
    });
    const user = userEvent.setup();
    renderPage();
    await user.type(screen.getByPlaceholderText(/search query/i), "oauth");
    await user.click(screen.getByRole("button", { name: /search/i }));
    await waitFor(() =>
      expect(screen.getByText("Authentication via OAuth2.")).toBeTruthy(),
    );
    // Expand the card
    await user.click(screen.getByRole("button", { name: /expand/i }));
    expect(
      screen.getByText("authentication oauth2 tokens scopes"),
    ).toBeTruthy();
    expect(screen.getByText("framework")).toBeTruthy();
    expect(screen.getByText("express")).toBeTruthy();
    expect(screen.getByText("bm25-v3")).toBeTruthy();
    expect(screen.getByText("meta-extractor-v2")).toBeTruthy();
    expect(screen.getByText(/chunk-99/)).toBeTruthy();
  });

  it("renders sort control after search with results", async () => {
    vi.mocked(api.search).mockResolvedValue({
      results: [
        {
          id: "r1",
          denseText: "First result.",
          sparseText: "",
          metadata: {},
          similarity: 0.95,
          sourceFile: "a.ts",
        },
      ],
    });
    const user = userEvent.setup();
    renderPage();
    await user.type(screen.getByPlaceholderText(/search query/i), "test");
    await user.click(screen.getByRole("button", { name: /search/i }));
    // Sort-by label is visible once results load
    await waitFor(() => expect(screen.getByText(/Sort by/i)).toBeTruthy());
    expect(screen.getByText(/1 result/i)).toBeTruthy();
  });

  it("shows result count after search", async () => {
    vi.mocked(api.search).mockResolvedValue({
      results: [
        {
          id: "r1",
          denseText: "first",
          sparseText: "",
          metadata: {},
          similarity: 0.9,
          sourceFile: "a.ts",
        },
        {
          id: "r2",
          denseText: "second",
          sparseText: "",
          metadata: {},
          similarity: 0.8,
          sourceFile: "b.ts",
        },
      ],
    });
    const user = userEvent.setup();
    renderPage();
    await user.type(screen.getByPlaceholderText(/search query/i), "query");
    await user.click(screen.getByRole("button", { name: /search/i }));
    await waitFor(() => expect(screen.getByText(/2 results/i)).toBeTruthy());
  });
});
