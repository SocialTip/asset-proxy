#!/usr/bin/env bash
set -euo pipefail

# Collect coverage from both vitest (unit + integration tests) and the Docker
# containers that serve integration requests. Produces a single merged report.

REPO_ROOT=$(pwd)

rm -rf coverage .coverage-docker .coverage-server
mkdir -p .coverage-docker/asset-proxy .coverage-docker/cache-proxy

# Build proxy so the Docker containers can run compiled JS with source maps.
pnpm -w run build

# (Re)start containers in coverage mode — runs built JS instead of tsx --watch.
NODE_V8_COVERAGE=/coverage docker compose up -d --wait asset-proxy cache-proxy

# Run all tests with vitest's built-in coverage. The json reporter writes
# coverage/coverage-final.json; we suppress text output since the merge
# script produces its own combined text report at the end.
pnpm exec vitest run --coverage --coverage.reporter=json "$@"

# Stop containers so Node flushes NODE_V8_COVERAGE data to the mounted volumes.
docker compose stop asset-proxy cache-proxy

# Process server-side V8 coverage: remap container paths to host paths so c8
# can locate the source files and their source maps.
mkdir -p .coverage-server
cp .coverage-docker/asset-proxy/*.json .coverage-server/ 2>/dev/null || true
cp .coverage-docker/cache-proxy/*.json .coverage-server/ 2>/dev/null || true

if compgen -G ".coverage-server/*.json" > /dev/null; then
  sed -i '' "s|file:///app/|file://${REPO_ROOT}/|g" .coverage-server/*.json

  pnpm exec c8 report \
    --src "$REPO_ROOT" \
    --include 'packages/*/dist/**' \
    --temp-directory .coverage-server \
    --reporter json --reports-dir .coverage-server/out
fi

# Merge vitest and server-side coverage into a single report (text + lcov).
node scripts/merge-coverage.mjs \
  coverage/coverage-final.json \
  .coverage-server/out/coverage-final.json

echo ""
echo "Coverage report written to coverage/"

# Restart containers in normal dev mode (tsx --watch).
docker compose up -d asset-proxy cache-proxy
