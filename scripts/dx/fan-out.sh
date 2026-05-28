#!/usr/bin/env bash
# scripts/dx/fan-out.sh
# Usage: bash scripts/dx/fan-out.sh <BASE_SHA>
# Creates 5 lane worktrees + branches off BASE_SHA, runs npm install in each.
# Idempotent: skips worktrees that already exist; logs skip lines.

set -euo pipefail
BASE_SHA="${1:?BASE_SHA required as first arg}"
ROOT="$(git rev-parse --show-toplevel)"
WT_ROOT="$ROOT/.claude/worktrees"
LANES=(B-registry-tools C-validator-lib D-skill-sync F-ui E-prep)

echo "Fan-out: creating 5 lane worktrees off $BASE_SHA"
for LANE in "${LANES[@]}"; do
  WT="$WT_ROOT/lane-$LANE"
  BR="lane-$LANE"
  if [ -d "$WT" ]; then
    echo "  [SKIP] $WT already exists"
    continue
  fi
  echo "  [ADD]  $WT (branch $BR)"
  git worktree add "$WT" -b "$BR" "$BASE_SHA"
  ( cd "$WT" && npm install --silent ) || { echo "  [FAIL] npm install in $WT"; exit 1; }
  # Symlink node_modules to trunk's copy to save disk + time (optional optimisation)
  # Comment out if disk space isn't a concern.
  # rm -rf "$WT/node_modules" && ln -s "$ROOT/node_modules" "$WT/node_modules"
done

echo "LANES_READY"
for LANE in "${LANES[@]}"; do
  echo "  lane-$LANE: $WT_ROOT/lane-$LANE"
done
echo ""
echo "Next: spawn 5 Claude Code side-panel sessions, one per worktree path above."
echo "Paste the matching PROMPT 2-6 from §12 into each."
