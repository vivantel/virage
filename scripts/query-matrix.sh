#!/usr/bin/env bash
# Query matrix analysis: runs virage query for every config × query combination
# and prints a quality comparison table.
#
# Usage:  ./scripts/query-matrix.sh [--top-k N] [--virage-bin path/to/virage]
#
# Requirements:  jq, sha256sum, virage CLI on PATH (or pass --virage-bin)

set -euo pipefail

# ─── Defaults ────────────────────────────────────────────────────────────────

TOP_K=5
# Default: prefer local dist build over globally installed binary
_LOCAL_DIST="node $(dirname "$0")/../packages/virage-cli/dist/bin/virage.js"
VIRAGE_BIN="${VIRAGE_BIN:-$_LOCAL_DIST}"
PLUGIN_CACHE_BASE=".virage/eval-plugin-cache"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --top-k)    TOP_K="$2";    shift 2 ;;
    --virage-bin) VIRAGE_BIN="$2"; shift 2 ;;
    *) echo "Unknown flag: $1"; exit 1 ;;
  esac
done

# ─── Plugin env setup ─────────────────────────────────────────────────────────
# Sets VIRAGE_DIR to a stable per-config dir with pinned plugins installed.
# No-op when the config declares no pluginVersions.

setup_eval_env_for_config() {
  local config="$1"
  local packages
  packages=$(jq -r '.pluginVersions // {} | to_entries[] | "\(.key)@\(.value)"' "$config" 2>/dev/null | sort || true)
  if [[ -z "$packages" ]]; then
    return 0
  fi

  local key
  key=$(echo "$packages" | sha256sum | cut -c1-16)
  local plugin_dir="${PLUGIN_CACHE_BASE}/${key}"

  if [[ ! -d "${plugin_dir}/node_modules" ]]; then
    printf "  Installing plugins for %s → %s\n" "$config" "$plugin_dir"
    mkdir -p "$plugin_dir"
    # shellcheck disable=SC2086
    npm install --prefix "$plugin_dir" $packages
  fi

  export VIRAGE_DIR="$plugin_dir"
}

# ─── Matrix definition ───────────────────────────────────────────────────────

CONFIGS=(
  "virage.config.hybrid.cross-encoder.json"
  "virage.config.hybrid.json"
  "virage.config.vector.cross-encoder.json"
  "virage.config.vector.json"
)

# Format: "query text|expected_relevance"
# expected_relevance: relevant | irrelevant
QUERIES=(
  "embedding layer|relevant"
  "electricity battlestar|irrelevant"
)

# Quality thresholds
RELEVANT_MIN_COUNT=1
RELEVANT_MIN_SIM=0.70
# Minimum gap between relevant-query sim and irrelevant-query sim for the same
# config. Using a separation check instead of an absolute max-sim threshold
# because RRF normalises all scores to ~1.0 for the top result, making absolute
# thresholds meaningless for hybrid modes.
MIN_SEPARATION=0.15

# ─── ANSI helpers ────────────────────────────────────────────────────────────

GREEN="\033[32m"
RED="\033[31m"
YELLOW="\033[33m"
BOLD="\033[1m"
DIM="\033[2m"
RESET="\033[0m"

pass() { printf "${GREEN}PASS${RESET}"; }
fail() { printf "${RED}FAIL${RESET}"; }

# ─── Dependency check ────────────────────────────────────────────────────────

if ! command -v jq &>/dev/null; then
  echo "Error: jq is required. Install with: apt-get install jq  or  brew install jq"
  exit 1
fi

# Verify the virage command is runnable (handles both single-word and "node path/to/file" forms)
if ! eval "$VIRAGE_BIN --version" &>/dev/null; then
  echo "Error: virage CLI not found or not runnable: $VIRAGE_BIN"
  echo "Pass --virage-bin path/to/virage or set VIRAGE_BIN env var."
  exit 1
fi

# ─── Run matrix ──────────────────────────────────────────────────────────────

printf "\n${BOLD}Virage Query Matrix${RESET}\n"
printf "${DIM}top-k=%d  virage=%s${RESET}\n\n" "$TOP_K" "$VIRAGE_BIN"

# Table header
printf "${BOLD}%-46s %-12s %-8s %-10s %-6s${RESET}\n" "Config" "Query" "Expected" "Max sim" "Result"
printf "${DIM}%s${RESET}\n" "$(printf '─%.0s' {1..90})"

declare -A results   # config → (query → result_json)
declare -A rel_sims  # config → relevant-query max_sim (populated first, used for separation check)

ORIG_VIRAGE_DIR_QM="${VIRAGE_DIR:-}"

for CONFIG in "${CONFIGS[@]}"; do
  if [[ ! -f "$CONFIG" ]]; then
    printf "  ${YELLOW}⚠ Config not found: %s (skipping)${RESET}\n" "$CONFIG"
    continue
  fi

  # Install pinned plugins and set VIRAGE_DIR for this config
  unset VIRAGE_DIR
  [[ -n "$ORIG_VIRAGE_DIR_QM" ]] && export VIRAGE_DIR="$ORIG_VIRAGE_DIR_QM"
  setup_eval_env_for_config "$CONFIG"

  SHORT_CONFIG="${CONFIG#virage.config.}"  # strip prefix for display
  SHORT_CONFIG="${SHORT_CONFIG%.json}"

  for QUERY_SPEC in "${QUERIES[@]}"; do
    QUERY="${QUERY_SPEC%%|*}"
    EXPECTED="${QUERY_SPEC##*|}"

    START_MS=$(($(date +%s%3N)))

    # Run query — capture JSON output; on error produce empty array
    RAW_JSON=$(eval "$VIRAGE_BIN query \"$QUERY\" --config \"$CONFIG\" --top-k $TOP_K --json" 2>/dev/null) || RAW_JSON="[]"

    END_MS=$(($(date +%s%3N)))
    ELAPSED_MS=$((END_MS - START_MS))

    # Parse with jq — normalize to fixed-point so bc can handle near-zero values
    # that jq may emit in scientific notation (e.g. 5.96e-8)
    COUNT=$(echo "$RAW_JSON" | jq 'length')
    MAX_SIM=$(echo "$RAW_JSON" | jq '[.[].similarity] | if length == 0 then 0 else max end' | awk '{printf "%.10f", $1}')

    # Quality gate
    if [[ "$EXPECTED" == "relevant" ]]; then
      rel_sims["$CONFIG"]="$MAX_SIM"
      if (( COUNT >= RELEVANT_MIN_COUNT )) && \
         [[ $(echo "$MAX_SIM >= $RELEVANT_MIN_SIM" | bc -l) == 1 ]]; then
        STATUS="pass"
      else
        STATUS="fail"
      fi
    else  # irrelevant — separation check (RRF normalises all scores, so absolute
          # thresholds are meaningless for hybrid; separation is score-mode-agnostic)
      REL_SIM="${rel_sims[$CONFIG]:-0}"
      SEPARATION=$(echo "$REL_SIM - $MAX_SIM" | bc -l | awk '{printf "%.10f", $1}')
      if [[ $(echo "$SEPARATION >= $MIN_SEPARATION" | bc -l) == 1 ]]; then
        STATUS="pass"
      else
        STATUS="fail"
      fi
    fi

    MAX_SIM_PCT=$(echo "$MAX_SIM * 100" | bc -l | xargs printf "%.1f%%")

    printf "%-46s %-12s %-8s %-10s " \
      "$SHORT_CONFIG" \
      "${QUERY:0:12}" \
      "$EXPECTED" \
      "$MAX_SIM_PCT"

    if [[ "$STATUS" == "pass" ]]; then pass; else fail; fi
    printf "  ${DIM}(n=%d, %dms)${RESET}\n" "$COUNT" "$ELAPSED_MS"

    # Store for findings section
    results["${CONFIG}:::${QUERY}"]=$(printf '{"config":"%s","query":"%s","expected":"%s","count":%d,"max_sim":%s,"elapsed_ms":%d,"status":"%s"}' \
      "$SHORT_CONFIG" "$QUERY" "$EXPECTED" "$COUNT" "$MAX_SIM" "$ELAPSED_MS" "$STATUS")
  done
done

printf "${DIM}%s${RESET}\n\n" "$(printf '─%.0s' {1..90})"

# Restore VIRAGE_DIR
unset VIRAGE_DIR
[[ -n "$ORIG_VIRAGE_DIR_QM" ]] && export VIRAGE_DIR="$ORIG_VIRAGE_DIR_QM"

# ─── Findings ────────────────────────────────────────────────────────────────

printf "${BOLD}Findings${RESET}\n\n"

# Collect all result JSON into an array for analysis
ALL_JSON="["
FIRST=1
for KEY in "${!results[@]}"; do
  [[ "$FIRST" == 1 ]] && FIRST=0 || ALL_JSON+=","
  ALL_JSON+="${results[$KEY]}"
done
ALL_JSON+="]"

# Per-config pass rate
printf "${BOLD}Pass rate by config strategy:${RESET}\n"
for CONFIG in "${CONFIGS[@]}"; do
  [[ ! -f "$CONFIG" ]] && continue
  SHORT="${CONFIG#virage.config.}"; SHORT="${SHORT%.json}"
  TOTAL=0; PASSED=0
  for QUERY_SPEC in "${QUERIES[@]}"; do
    QUERY="${QUERY_SPEC%%|*}"
    KEY="${CONFIG}:::${QUERY}"
    if [[ -v "results[$KEY]" ]]; then
      TOTAL=$((TOTAL + 1))
      STATUS=$(echo "${results[$KEY]}" | jq -r '.status')
      [[ "$STATUS" == "pass" ]] && PASSED=$((PASSED + 1))
    fi
  done
  if (( PASSED == TOTAL )); then
    printf "  ${GREEN}✓${RESET} %-44s %d/%d\n" "$SHORT" "$PASSED" "$TOTAL"
  else
    printf "  ${RED}✗${RESET} %-44s %d/%d\n" "$SHORT" "$PASSED" "$TOTAL"
  fi
done

echo ""
printf "${BOLD}Similarity scores for 'embedding layer' (relevance test):${RESET}\n"
for CONFIG in "${CONFIGS[@]}"; do
  [[ ! -f "$CONFIG" ]] && continue
  SHORT="${CONFIG#virage.config.}"; SHORT="${SHORT%.json}"
  KEY="${CONFIG}:::embedding layer"
  if [[ -v "results[$KEY]" ]]; then
    SIM=$(echo "${results[$KEY]}" | jq -r '(.max_sim * 100 | floor | tostring) + "%"')
    N=$(echo "${results[$KEY]}" | jq -r '.count')
    printf "  %-44s sim=%-6s n=%d\n" "$SHORT" "$SIM" "$N"
  fi
done

echo ""
printf "${BOLD}Similarity scores for 'electricity battlestar' (noise test):${RESET}\n"
for CONFIG in "${CONFIGS[@]}"; do
  [[ ! -f "$CONFIG" ]] && continue
  SHORT="${CONFIG#virage.config.}"; SHORT="${SHORT%.json}"
  KEY="${CONFIG}:::electricity battlestar"
  if [[ -v "results[$KEY]" ]]; then
    SIM=$(echo "${results[$KEY]}" | jq -r '(.max_sim * 100 | floor | tostring) + "%"')
    N=$(echo "${results[$KEY]}" | jq -r '.count')
    printf "  %-44s sim=%-6s n=%d\n" "$SHORT" "$SIM" "$N"
  fi
done

echo ""
printf "${BOLD}Improvement signals:${RESET}\n"

# Helper: safely get .max_sim from results associative array (returns 0 if missing)
get_sim() {
  local key="$1"
  local val
  val="${results[$key]:-}"
  if [[ -z "$val" ]]; then echo "0"; return; fi
  echo "$val" | jq -r '.max_sim // 0' | awk '{printf "%.10f", $1}'
}

compare_configs() {
  local label="$1" a_key="$2" b_key="$3" a_label="$4" b_label="$5"
  local a_sim b_sim
  a_sim=$(get_sim "$a_key")
  b_sim=$(get_sim "$b_key")
  if [[ $(echo "$a_sim > $b_sim" | bc -l) == 1 ]]; then
    printf "  ${GREEN}✓${RESET} %s improves over %s (%.1f%% → %.1f%%)\n" \
      "$label" "$b_label" \
      "$(echo "$b_sim * 100" | bc -l)" "$(echo "$a_sim * 100" | bc -l)"
  elif [[ $(echo "$a_sim < $b_sim" | bc -l) == 1 ]]; then
    printf "  ${YELLOW}⚠${RESET} %s does NOT improve over %s (%.1f%% → %.1f%%)\n" \
      "$label" "$b_label" \
      "$(echo "$b_sim * 100" | bc -l)" "$(echo "$a_sim * 100" | bc -l)"
  else
    printf "  ${DIM}–${RESET} %s and %s perform identically\n" "$label" "$b_label"
  fi
}

compare_configs \
  "Cross-encoder on hybrid" \
  "virage.config.hybrid.cross-encoder.json:::embedding layer" \
  "virage.config.hybrid.json:::embedding layer" \
  "hybrid+cross-encoder" "hybrid"

compare_configs \
  "Cross-encoder on vector" \
  "virage.config.vector.cross-encoder.json:::embedding layer" \
  "virage.config.vector.json:::embedding layer" \
  "vector+cross-encoder" "vector"

compare_configs \
  "Hybrid search" \
  "virage.config.hybrid.json:::embedding layer" \
  "virage.config.vector.json:::embedding layer" \
  "hybrid" "vector"

# Separation check: configs where relevant_sim - irrelevant_sim < MIN_SEPARATION
NOISY=0
for CONFIG in "${CONFIGS[@]}"; do
  [[ ! -f "$CONFIG" ]] && continue
  REL_KEY="${CONFIG}:::embedding layer"
  IRR_KEY="${CONFIG}:::electricity battlestar"
  if [[ -v "results[$REL_KEY]" && -v "results[$IRR_KEY]" ]]; then
    REL_S=$(echo "${results[$REL_KEY]}" | jq -r '.max_sim' | awk '{printf "%.10f", $1}')
    IRR_S=$(echo "${results[$IRR_KEY]}" | jq -r '.max_sim' | awk '{printf "%.10f", $1}')
    SEP=$(echo "$REL_S - $IRR_S" | bc -l | awk '{printf "%.10f", $1}')
    if [[ $(echo "$SEP < $MIN_SEPARATION" | bc -l) == 1 ]]; then
      NOISY=$((NOISY + 1))
    fi
  fi
done

if (( NOISY > 0 )); then
  printf "  ${RED}✗${RESET} %d config(s) have insufficient relevance separation (< %.0f%% gap)\n" \
    "$NOISY" "$(echo "$MIN_SEPARATION * 100" | bc -l)"
  printf "    ${DIM}→ Consider raising min_score threshold or tightening hybridAlpha${RESET}\n"
else
  printf "  ${GREEN}✓${RESET} All configs have sufficient relevance separation (≥ %.0f%% gap)\n" \
    "$(echo "$MIN_SEPARATION * 100" | bc -l)"
fi

echo ""
