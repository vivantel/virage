#!/usr/bin/env bash
set -euo pipefail

# One-line installer for @vivantel/virage-cli
# Usage: curl -fsSL https://raw.githubusercontent.com/vivantel/virage/master/scripts/install.sh | bash

PACKAGE="@vivantel/virage-cli"

info()  { printf '\033[0;36m%s\033[0m\n' "$*"; }
ok()    { printf '\033[0;32m✓ %s\033[0m\n' "$*"; }
warn()  { printf '\033[0;33m! %s\033[0m\n' "$*" >&2; }
die()   { printf '\033[0;31mError: %s\033[0m\n' "$*" >&2; exit 1; }

# ── Node.js detection and installation ─���─────────────────────────────────────

ensure_node() {
  if command -v node >/dev/null 2>&1; then
    ok "Node.js $(node --version) found"
    return
  fi

  warn "Node.js not found. Attempting to install Node.js LTS..."

  # nvm
  if command -v nvm >/dev/null 2>&1 || [ -s "$HOME/.nvm/nvm.sh" ]; then
    # shellcheck source=/dev/null
    [ -s "$HOME/.nvm/nvm.sh" ] && source "$HOME/.nvm/nvm.sh"
    info "Installing Node.js LTS via nvm..."
    nvm install --lts
    nvm use --lts
    ok "Node.js $(node --version) installed via nvm"
    return
  fi

  # fnm
  if command -v fnm >/dev/null 2>&1; then
    info "Installing Node.js LTS via fnm..."
    fnm install --lts
    fnm use lts-latest
    ok "Node.js $(node --version) installed via fnm"
    return
  fi

  # Homebrew (macOS)
  if [[ "$(uname)" == "Darwin" ]] && command -v brew >/dev/null 2>&1; then
    info "Installing Node.js via Homebrew..."
    brew install node
    ok "Node.js $(node --version) installed via Homebrew"
    return
  fi

  # apt-get (Debian/Ubuntu)
  if command -v apt-get >/dev/null 2>&1; then
    info "Installing Node.js LTS via apt..."
    sudo apt-get update -qq
    sudo apt-get install -y nodejs npm
    ok "Node.js $(node --version) installed via apt"
    return
  fi

  # dnf/yum (RHEL/Fedora)
  if command -v dnf >/dev/null 2>&1; then
    info "Installing Node.js LTS via dnf..."
    sudo dnf install -y nodejs npm
    ok "Node.js $(node --version) installed via dnf"
    return
  fi

  die "Could not install Node.js automatically. Install it manually from https://nodejs.org and re-run this script."
}

# ── Main ────────────────��──────────────────────��──────────────────────────────

info "Installing virage CLI..."
ensure_node

if ! command -v npm >/dev/null 2>&1; then
  die "npm not found. Please install npm alongside Node.js and retry."
fi

info "Running: npm install -g $PACKAGE"
npm install -g "$PACKAGE"

ok "virage CLI installed successfully!"
info "Get started: virage --version"
