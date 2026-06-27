#!/usr/bin/env bash
# eval-matrix.sh — run virage eval save for each search config and compare all vs baseline
#
# Usage:
#   ./scripts/eval-matrix.sh [--dataset path] [--top-k N]
#
# Requirements: virage CLI built (npm run build -w @vivantel/virage-cli), jq

set -euo pipefail

DATASET="eval/quality-evaluation.ds.json"
TOP_K=10
_LOCAL_DIST="node $(dirname "$0")/../packages/virage-cli/dist/bin/virage.js"
VIRAGE="${VIRAGE_BIN:-$_LOCAL_DIST}"
BASELINE="vector"
PLUGIN_CACHE_BASE=".virage/eval-plugin-cache"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dataset)  DATASET="$2"; shift 2 ;;
    --top-k)    TOP_K="$2";   shift 2 ;;
    *) echo "Unknown flag: $1"; exit 1 ;;
  esac
done

# ─── Plugin env setup ─────────────────────────────────────────────────────────
# Sets VIRAGE_DIR to a stable per-config dir that has plugins installed.
# If the config declares no pluginVersions, VIRAGE_DIR is left unchanged.

setup_eval_env_for_config() {
  local config="$1"
  local packages
  packages=$(jq -r '.pluginVersions // {} | to_entries[] | "\(.key)@\(.value)"' "$config" 2>/dev/null | sort || true)
  if [[ -z "$packages" ]]; then
    return 0  # no plugin versions declared; use default VIRAGE_DIR
  fi

  local key
  key=$(echo "$packages" | sha256sum | cut -c1-16)
  local plugin_dir="${PLUGIN_CACHE_BASE}/${key}"

  if [[ ! -d "${plugin_dir}/node_modules" ]]; then
    echo "  Installing plugins for ${config} → ${plugin_dir}"
    mkdir -p "$plugin_dir"
    # shellcheck disable=SC2086
    npm install --prefix "$plugin_dir" $packages
  fi

  export VIRAGE_DIR="$plugin_dir"
}

# Config variants: name:path
CONFIGS=(
  "vector:virage.config.vector.json"
  "hybrid:virage.config.hybrid.json"
  "vector-cross-encoder:virage.config.vector.cross-encoder.json"
  "hybrid-cross-encoder:virage.config.hybrid.cross-encoder.json"
)

# ─── Validate ─────────────────────────────────────────────────────────────────

if ! eval "$VIRAGE --version" &>/dev/null; then
  echo "Error: virage CLI not runnable: $VIRAGE"
  echo "Build it first: npm run build -w @vivantel/virage-cli"
  exit 1
fi

if [[ ! -f "$DATASET" ]]; then
  echo "Error: dataset not found: $DATASET"
  exit 1
fi

# ─── Run evals ────────────────────────────────────────────────────────────────

echo ""
echo "  Virage Eval Matrix"
echo "  dataset: $DATASET  top-k: $TOP_K"
echo ""

declare -A RUN_IDS
ORIG_VIRAGE_DIR="${VIRAGE_DIR:-}"

for spec in "${CONFIGS[@]}"; do
  name="${spec%%:*}"
  config="${spec##*:}"

  if [[ ! -f "$config" ]]; then
    echo "  ⚠  Config not found: $config (skipping $name)"
    continue
  fi

  # Install pinned plugins and set VIRAGE_DIR for this config
  unset VIRAGE_DIR
  [[ -n "$ORIG_VIRAGE_DIR" ]] && export VIRAGE_DIR="$ORIG_VIRAGE_DIR"
  setup_eval_env_for_config "$config"

  echo "  ▶ $name"
  OUTPUT=$(eval "$VIRAGE eval save --name $name --config $config --dataset $DATASET" 2>&1)
  echo "$OUTPUT" | grep -E "MRR|Precision|saved" | sed 's/^/    /'

  RUN_ID=$(echo "$OUTPUT" | grep -oE '"[a-zA-Z0-9_-]+"' | tail -1 | tr -d '"')
  if [[ -z "$RUN_ID" ]]; then
    # Fall back to matching the printed run ID format: name_YYYY-MM-DDTHH-MM-SS
    RUN_ID=$(echo "$OUTPUT" | grep -oE "[a-zA-Z0-9_-]+_[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}-[0-9]{2}-[0-9]{2}" | tail -1)
  fi
  RUN_IDS["$name"]="$RUN_ID"
  echo "    saved: ${RUN_ID:-<id unavailable>}"
  echo ""
done

# Restore VIRAGE_DIR to its original value
unset VIRAGE_DIR
[[ -n "$ORIG_VIRAGE_DIR" ]] && export VIRAGE_DIR="$ORIG_VIRAGE_DIR"

# ─── Compare all vs baseline ──────────────────────────────────────────────────

if [[ -z "${RUN_IDS[$BASELINE]:-}" ]]; then
  echo "Error: baseline run '$BASELINE' did not produce a run ID."
  exit 1
fi

echo ""
echo "  ━━━━ vs baseline: $BASELINE (${RUN_IDS[$BASELINE]}) ━━━━"
echo ""

for spec in "${CONFIGS[@]}"; do
  name="${spec%%:*}"
  [[ "$name" == "$BASELINE" ]] && continue
  [[ -z "${RUN_IDS[$name]:-}" ]] && echo "  ⚠  No run ID for $name — skipping comparison" && continue

  echo "  ── $name ──"
  eval "$VIRAGE eval compare --baseline ${RUN_IDS[$BASELINE]} --candidate ${RUN_IDS[$name]}" | sed 's/^/  /'
  echo ""
done
