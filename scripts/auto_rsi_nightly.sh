#!/usr/bin/env bash
# Compat shim — moved to autoresearch/scripts/auto_rsi_nightly.sh.
# Keeps existing EC2 crontab entries working during the layout rollout.
# Remove once host crontabs reference the new path.
exec "$(cd "$(dirname "$0")/.." && pwd)/autoresearch/scripts/auto_rsi_nightly.sh" "$@"
