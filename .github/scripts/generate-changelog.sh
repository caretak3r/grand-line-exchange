#!/usr/bin/env bash
set -euo pipefail

# Builds the release-note body for a semver tag by diffing conventional
# commits since the previous tag. Hourly price-update bot commits and bd
# interaction-log commits are filtered out - left in, they'd bury every
# release under hundreds of "📊 price update ..." lines.
#
# Usage:
#   generate-changelog.sh <tag>            # writes `body<<EOF...EOF` to $GITHUB_OUTPUT (CI mode)
#   generate-changelog.sh <tag> --dry-run  # prints the body to stdout instead (local verification)

TAG="${1:?usage: generate-changelog.sh <tag> [--dry-run]}"
MODE="${2:-}"

# Commit subjects to drop entirely - the hourly scraper bot and the bd
# interaction-log chore both commit far more often than real feature work.
BOT_FILTER='^📊 price update|^chore: bd interaction log'

PREV_TAG="$(git describe --tags --abbrev=0 "${TAG}^" 2>/dev/null || true)"
if [ -n "$PREV_TAG" ]; then
  RANGE="${PREV_TAG}..${TAG}"
else
  RANGE="${TAG}"
fi

FILTERED="$(git log "$RANGE" --no-merges --pretty=format:'%s|%h' 2>/dev/null | grep -Ev "$BOT_FILTER" || true)"

declare -a TYPES=(feat fix perf refactor docs test ci build chore)
declare -A LABELS=(
  [feat]="Features" [fix]="Fixes" [perf]="Performance" [refactor]="Refactors"
  [docs]="Documentation" [test]="Tests" [ci]="CI/CD" [build]="Build" [chore]="Chores"
)

BODY="## What's Changed"$'\n'
MATCHED_HASHES=""

for type in "${TYPES[@]}"; do
  section="$(printf '%s\n' "$FILTERED" | grep -E "^${type}(\([^)]*\))?!?:" || true)"
  [ -z "$section" ] && continue
  BODY+=$'\n'"### ${LABELS[$type]}"$'\n'
  while IFS='|' read -r subject hash; do
    [ -z "$subject" ] && continue
    BODY+="- ${subject} (${hash})"$'\n'
    MATCHED_HASHES+="${hash} "
  done <<< "$section"
done

OTHER="$(printf '%s\n' "$FILTERED" | grep -Ev "^($(IFS='|'; echo "${TYPES[*]}"))(\([^)]*\))?!?:" || true)"
if [ -n "$OTHER" ]; then
  BODY+=$'\n'"### Other"$'\n'
  while IFS='|' read -r subject hash; do
    [ -z "$subject" ] && continue
    BODY+="- ${subject} (${hash})"$'\n'
  done <<< "$OTHER"
fi

if [ -n "$PREV_TAG" ] && [ -n "${GITHUB_REPOSITORY:-}" ]; then
  BODY+=$'\n'"**Full diff**: https://github.com/${GITHUB_REPOSITORY}/compare/${PREV_TAG}...${TAG}"
fi

if [ "$MODE" = "--dry-run" ] || [ -z "${GITHUB_OUTPUT:-}" ]; then
  printf '%s\n' "$BODY"
else
  {
    echo "body<<GLX_CHANGELOG_EOF"
    printf '%s\n' "$BODY"
    echo "GLX_CHANGELOG_EOF"
  } >> "$GITHUB_OUTPUT"
fi
