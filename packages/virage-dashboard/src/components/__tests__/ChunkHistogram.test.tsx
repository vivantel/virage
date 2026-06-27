import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PrimeReactProvider } from "primereact/api";
import { ChunkHistogram } from "../ChunkHistogram";

function render$(buckets: { label: string; count: number }[]) {
  return render(
    <PrimeReactProvider>
      <ChunkHistogram buckets={buckets} />
    </PrimeReactProvider>,
  );
}

describe("ChunkHistogram", () => {
  it("renders empty state when no buckets provided", () => {
    render$([]);
    expect(screen.getByText(/no chunks indexed/i)).toBeTruthy();
    expect(screen.getByText(/virage index/i)).toBeTruthy();
  });

  it("renders empty state when all buckets have count 0", () => {
    render$([
      { label: "< 200 chars", count: 0 },
      { label: "200–500 chars", count: 0 },
    ]);
    expect(screen.getByText(/no chunks indexed/i)).toBeTruthy();
  });

  it("renders the card title in all cases", () => {
    render$([]);
    expect(screen.getByText("Chunk Size Distribution")).toBeTruthy();
  });

  it("renders a chart when buckets have non-zero counts", () => {
    render$([
      { label: "< 200 chars", count: 5 },
      { label: "200–500 chars", count: 12 },
    ]);
    // Should NOT show empty state
    expect(screen.queryByText(/no chunks indexed/i)).toBeNull();
    // Should show chart (canvas is stubbed in test-setup)
    expect(screen.getByText("Chunk Size Distribution")).toBeTruthy();
  });
});
