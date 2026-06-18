import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PrimeReactProvider } from "primereact/api";
import { ChunkBrowser } from "../ChunkBrowser";

vi.mock("../../api/client", () => ({
  api: {
    chunksAll: vi.fn(),
    deleteChunksFile: vi.fn(),
    deleteChunksAll: vi.fn(),
  },
}));

import { api } from "../../api/client";

const sampleChunks = [
  { contentHash: "hash1", sourceFile: "src/auth.ts", content: "Auth logic here, very interesting content.", metadata: {} },
  { contentHash: "hash2", sourceFile: "src/router.ts", content: "Router setup and middleware.", metadata: {} },
  { contentHash: "hash3", sourceFile: "src/auth.ts", content: "Token validation function.", metadata: {} },
];

function renderPage() {
  return render(
    <PrimeReactProvider>
      <ChunkBrowser />
    </PrimeReactProvider>,
  );
}

describe("ChunkBrowser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.chunksAll).mockResolvedValue({ chunks: sampleChunks });
  });

  it("renders Chunk Browser heading", () => {
    renderPage();
    expect(screen.getByText("Chunk Browser")).toBeTruthy();
  });

  it("displays all chunks in the table after load", async () => {
    renderPage();
    await waitFor(() => expect(screen.getAllByText(/src\/(auth|router)\.ts/).length).toBeGreaterThan(0));
    expect(screen.getByText(/Auth logic here/)).toBeTruthy();
    expect(screen.getByText(/Router setup/)).toBeTruthy();
  });

  it("shows Clear all button", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByRole("button", { name: /clear all/i })).toBeTruthy());
  });

  it("prompts for confirmation before clearing all", async () => {
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => screen.getByRole("button", { name: /clear all/i }));
    await user.click(screen.getByRole("button", { name: /clear all/i }));
    expect(screen.getByText(/Sure/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /yes, clear all/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /cancel/i })).toBeTruthy();
  });

  it("cancels clear-all when Cancel is clicked", async () => {
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => screen.getByRole("button", { name: /clear all/i }));
    await user.click(screen.getByRole("button", { name: /clear all/i }));
    await user.click(screen.getByRole("button", { name: /cancel/i }));
    expect(screen.getByRole("button", { name: /clear all/i })).toBeTruthy();
    expect(api.deleteChunksAll).not.toHaveBeenCalled();
  });

  it("calls deleteChunksAll and reloads on confirm", async () => {
    vi.mocked(api.deleteChunksAll).mockResolvedValue({ ok: true });
    vi.mocked(api.chunksAll)
      .mockResolvedValueOnce({ chunks: sampleChunks })
      .mockResolvedValue({ chunks: [] });
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => screen.getByRole("button", { name: /clear all/i }));
    await user.click(screen.getByRole("button", { name: /clear all/i }));
    await user.click(screen.getByRole("button", { name: /yes, clear all/i }));
    await waitFor(() => expect(api.deleteChunksAll).toHaveBeenCalledOnce());
    expect(api.chunksAll).toHaveBeenCalledTimes(2);
  });

  it("shows error card when load fails", async () => {
    vi.mocked(api.chunksAll).mockRejectedValue(new Error("DB error"));
    renderPage();
    await waitFor(() => expect(screen.getByText(/DB error/)).toBeTruthy());
  });
});
