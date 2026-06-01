/**
 * Bootstrap paired significance test for comparing two experiment runs.
 * Pure TypeScript, no external dependencies.
 */

export interface StatTestResult {
  baselineMrr: number;
  candidateMrr: number;
  mrrDelta: number;
  /** One-tailed p-value: P(candidate ≤ baseline | H0: no difference). */
  pValue: number;
  /** 95% confidence interval on the MRR delta [lower, upper]. */
  confidenceInterval95: [number, number];
  /** "accept" (p < 0.05 and delta > 0), "reject" (p < 0.05 and delta ≤ 0), or "inconclusive". */
  recommendation: "accept" | "reject" | "inconclusive";
}

/**
 * Bootstrap paired test comparing per-query reciprocal-rank scores.
 *
 * Algorithm:
 *  1. Compute observed delta = mean(candidate) - mean(baseline).
 *  2. Resample paired differences with replacement n=iterations times.
 *  3. p-value = fraction of bootstrap deltas ≤ 0 (one-tailed, candidate better).
 *  4. 95% CI = [2.5th, 97.5th] percentile of the bootstrap distribution of deltas.
 */
export function bootstrapPairedTest(
  baselinePerQuery: number[],
  candidatePerQuery: number[],
  iterations = 10_000,
): StatTestResult {
  if (baselinePerQuery.length !== candidatePerQuery.length) {
    throw new Error(
      `Baseline and candidate must have the same number of queries ` +
        `(got ${baselinePerQuery.length} vs ${candidatePerQuery.length})`,
    );
  }

  const n = baselinePerQuery.length;
  if (n === 0) {
    throw new Error("Cannot run statistical test on empty query sets");
  }

  const mean = (arr: number[]) => arr.reduce((s, v) => s + v, 0) / arr.length;

  const baselineMrr = mean(baselinePerQuery);
  const candidateMrr = mean(candidatePerQuery);
  const observedDelta = candidateMrr - baselineMrr;

  // Per-query differences
  const differences = baselinePerQuery.map((b, i) => candidatePerQuery[i] - b);

  // Bootstrap: resample differences with replacement
  const bootstrapDeltas: number[] = new Array(iterations);
  for (let iter = 0; iter < iterations; iter++) {
    let sum = 0;
    for (let i = 0; i < n; i++) {
      sum += differences[Math.floor(Math.random() * n)];
    }
    bootstrapDeltas[iter] = sum / n;
  }

  bootstrapDeltas.sort((a, b) => a - b);

  // One-tailed: P(bootstrap delta ≤ 0) — probability of no improvement by chance.
  // Low value → candidate is significantly better than baseline.
  const pValue =
    bootstrapDeltas.filter((d) => d <= 0).length / iterations;

  const loIdx = Math.max(0, Math.floor(0.025 * iterations) - 1);
  const hiIdx = Math.min(iterations - 1, Math.ceil(0.975 * iterations));
  const lo = bootstrapDeltas[loIdx];
  const hi = bootstrapDeltas[hiIdx];

  // Drive recommendation from the 95% CI: if the entire interval lies on one
  // side of 0, we have a clear signal; otherwise the effect is uncertain.
  let recommendation: StatTestResult["recommendation"];
  if (lo > 0) {
    recommendation = "accept"; // CI entirely positive → candidate is better
  } else if (hi < 0) {
    recommendation = "reject"; // CI entirely negative → candidate is worse
  } else {
    recommendation = "inconclusive"; // CI straddles 0 → no clear winner
  }

  return {
    baselineMrr,
    candidateMrr,
    mrrDelta: observedDelta,
    pValue,
    confidenceInterval95: [lo, hi],
    recommendation,
  };
}
