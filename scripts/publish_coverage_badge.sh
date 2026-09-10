#!/usr/bin/env bash
# Publish the coverage figure CI just measured as a shields.io endpoint document.
#
# repository-baseline-policy.md §5.1: a badge whose value is written by a human
# is forbidden — it renders identically to a real one, so a reader cannot tell
# them apart, and it becomes false the moment reality moves without anyone
# editing a file.
#
# The badge in README.md renders whatever this script last wrote to
# `coverage.json` on the orphan `badges` branch. The number therefore comes
# from the same `coverage/coverage-summary.json` that `vitest run --coverage`
# (the gate `vitest.config.ts`'s `thresholds` block exits non-zero on) just
# wrote, not a figure re-derived from parsed stdout.
#
# Runs from .github/workflows/ci.yml on pushes to main only. The `badges`
# branch is seeded before this script was ever wired in (nousergon-auth
# baseline/I10431), so the contents API is enough and no branch is ever
# created here.
set -euo pipefail

: "${GH_TOKEN:?GH_TOKEN is required to publish the badge document}"
: "${GITHUB_REPOSITORY:?GITHUB_REPOSITORY is required}"

BRANCH="badges"
DOC="coverage.json"
SUMMARY="coverage/coverage-summary.json"

if [ ! -f "${SUMMARY}" ]; then
  echo "::error::${SUMMARY} not found — did the coverage step run first?" >&2
  exit 1
fi

# `lines.pct` — the same metric vitest's own text report leads with, and one
# of the four dimensions the `thresholds` block in vitest.config.ts gates on.
PCT="$(node -e "const s=require('./${SUMMARY}');process.stdout.write(s.total.lines.pct.toFixed(2))")"

# shields' own convention: red below 60, yellow below 80, green above 90.
COLOR="$(node -e "
const pct = parseFloat('${PCT}');
process.stdout.write(pct >= 90 ? 'brightgreen' : pct >= 80 ? 'green' : pct >= 60 ? 'yellow' : 'red');
")"

node -e "
const fs = require('fs');
fs.writeFileSync('badge-endpoint.json', JSON.stringify({
  schemaVersion: 1,
  label: 'coverage',
  message: '${PCT}%',
  color: '${COLOR}',
}, null, 2) + '\n');
"

echo "measured coverage (lines): ${PCT}% (${COLOR})"

# The contents API needs the blob sha to replace an existing file. Its absence
# is a hard error rather than a create, because a missing document means the
# `badges` branch is gone — and silently recreating it would hide that the
# README badge has been rendering an error to every reader in the meantime.
SHA="$(gh api "repos/${GITHUB_REPOSITORY}/contents/${DOC}?ref=${BRANCH}" --jq '.sha')"

if [ -z "${SHA}" ]; then
  echo "::error::${DOC} not found on the ${BRANCH} branch — the README badge is broken" >&2
  exit 1
fi

if [ "$(gh api "repos/${GITHUB_REPOSITORY}/contents/${DOC}?ref=${BRANCH}" --jq '.content' | base64 --decode)" = "$(cat badge-endpoint.json)" ]; then
  echo "coverage unchanged at ${PCT}% — nothing to publish"
  exit 0
fi

gh api --method PUT "repos/${GITHUB_REPOSITORY}/contents/${DOC}" \
  -f message="chore(badges): coverage ${PCT}% from ${GITHUB_SHA:-HEAD}" \
  -f branch="${BRANCH}" \
  -f sha="${SHA}" \
  -f content="$(base64 < badge-endpoint.json | tr -d '\n')" \
  --jq '.commit.sha'
