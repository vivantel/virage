import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PrimeReactProvider } from "primereact/api";
import { SearchPage } from "../SearchPage";

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
          content: "Auth uses JWT tokens.",
          metadata: {},
          similarity: 0.92,
          sourceFile: "src/auth.ts",
        },
        {
          id: "r2",
          content: "Session expires after 1h.",
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
      expect(mockShowError).toHaveBeenCalledWith("Search failed", "Search failed"),
    );
  });

  it("displays source file badge in results", async () => {
    vi.mocked(api.search).mockResolvedValue({
      results: [
        {
          id: "r1",
          content: "Content.",
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
});
