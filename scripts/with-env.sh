#!/usr/bin/env bash
# Runs a command with the Pine and GitHub keys read from the macOS Keychain, so no key
# ever lands in the repo, a dotfile or a chat transcript. Env vars already set win.
set -euo pipefail

kc() { security find-generic-password -a "$USER" -s "$1" -w 2>/dev/null || true; }

export PINE_SANDBOX_API_KEY="${PINE_SANDBOX_API_KEY:-$(kc pine-project-key)}"
export PINE_SANDBOX_ENDPOINT="${PINE_SANDBOX_ENDPOINT:-https://pinesandbox.io}"
export GH_TRIAGE_TOKEN="${GH_TRIAGE_TOKEN:-$(kc gh-triage-token)}"

if [ -z "$PINE_SANDBOX_API_KEY" ]; then
  echo "missing Pine key: security add-generic-password -a \"\$USER\" -s pine-project-key -w" >&2
  exit 1
fi

exec "$@"
