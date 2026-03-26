#!/usr/bin/env bash
set -euo pipefail

# Collect coverage from both vitest (unit + integration tests) and the Docker
# containers that serve integration requests. Produces separate lcov reports
# from each source and merges them by taking the max count per line.

REPO_ROOT=$(pwd)

rm -rf coverage .coverage-raw .coverage-docker .coverage-server-report
mkdir -p .coverage-docker/asset-proxy .coverage-docker/cache-proxy .coverage-raw

# (Re)start containers in coverage mode — runs tsx with --conditions source
# so all packages resolve to src/ TypeScript, matching vitest's resolution.
NODE_V8_COVERAGE=/coverage docker compose up -d --wait asset-proxy cache-proxy

# Run all tests with vitest's built-in v8 coverage.
pnpm exec vitest run --coverage "$@"

# Save vitest's lcov before the merge overwrites coverage/.
cp coverage/lcov.info .coverage-raw/vitest-lcov.info

# Stop containers so Node flushes NODE_V8_COVERAGE data to the mounted volumes.
docker compose stop asset-proxy cache-proxy

# Collect server-side V8 coverage and remap container paths to host paths.
mkdir -p .coverage-raw/server
cp .coverage-docker/asset-proxy/*.json .coverage-raw/server/ 2>/dev/null || true
cp .coverage-docker/cache-proxy/*.json .coverage-raw/server/ 2>/dev/null || true

if compgen -G ".coverage-raw/server/*.json" > /dev/null; then
  sed -i '' "s|file:///app/|file://${REPO_ROOT}/|g" .coverage-raw/server/*.json

  # Convert server V8 data to lcov via c8. The V8 data has src/ URLs (tsx
  # loaded source directly) so c8 can read the .ts files from disk.
  pnpm exec c8 report \
    --src "$REPO_ROOT" \
    --include 'packages/*/src/**' \
    --exclude '**/__mocks__/**' \
    --temp-directory .coverage-raw/server \
    --reporter lcov --reports-dir .coverage-server-report
fi

# Merge vitest + server lcov (max count per line, regenerates HTML report).
node scripts/merge-coverage.mjs \
  .coverage-raw/vitest-lcov.info \
  .coverage-server-report/lcov.info

echo ""
echo "Coverage report written to coverage/"

# Restart containers in normal dev mode (tsx --watch).
docker compose up -d asset-proxy cache-proxy
