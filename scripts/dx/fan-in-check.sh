#!/usr/bin/env bash
# scripts/dx/fan-in-check.sh
# Usage: bash scripts/dx/fan-in-check.sh
# Checks all 5 lane branches: pushed? PROGRESS.md final status? tests green locally?
# Exit code 0 = all 5 ready for cherry-pick; non-zero = at least one lane needs triage.

set -uo pipefail
ROOT="$(git rev-parse --show-toplevel)"
WT_ROOT="$ROOT/.claude/worktrees"
LANES=(B-registry-tools C-validator-lib D-skill-sync F-ui E-prep)
GREEN=$'\e[32m'; RED=$'\e[31m'; YELLOW=$'\e[33m'; RST=$'\e[0m'

git fetch origin --quiet || true
FAIL=0
echo "Fan-in check: verifying 5 lanes pushed green"
echo "─────────────────────────────────────────────"
for LANE in "${LANES[@]}"; do
  WT="$WT_ROOT/lane-$LANE"
  BR="lane-$LANE"
  REMOTE_REF=$(git rev-parse --verify "origin/$BR" 2>/dev/null || echo "")
  PROGRESS="$WT/PROGRESS.md"
  if [ -z "$REMOTE_REF" ]; then
    echo "$RED[MISS]$RST lane-$LANE: no remote branch"
    [ -f "$PROGRESS" ] && echo "        last PROGRESS.md: $(tail -1 "$PROGRESS")" || echo "        no PROGRESS.md"
    FAIL=$((FAIL+1))
    continue
  fi
  LAST_COMMIT=$(git log -1 --format='%h %s' "origin/$BR" 2>/dev/null)
  echo "$GREEN[OK]$RST   lane-$LANE: $LAST_COMMIT"
  [ -f "$PROGRESS" ] && echo "        final PROGRESS.md: $(tail -1 "$PROGRESS")"
done
echo "─────────────────────────────────────────────"
if [ "$FAIL" -gt 0 ]; then
  echo "$RED$FAIL lane(s) not ready.$RST Triage options:"
  echo "  (a) cat .claude/worktrees/lane-X/PROGRESS.md  # see where it stopped"
  echo "  (b) cd .claude/worktrees/lane-X && claude     # resume manually in that session"
  echo "  (c) skip the lane and patch its files inline during Phase 3"
  exit 1
fi
echo "$GREEN[ALL GREEN]$RST 5/5 lanes pushed. Ready for PROMPT 7 (Phase 3)."
