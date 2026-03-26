#!/usr/bin/env bash
set -euo pipefail

# Collect coverage from both vitest (unit + integration tests) and the Docker
# containers that serve integration requests. Merges raw V8 coverage from both
# sources using monocart-coverage-reports for consistent statement maps.

REPO_ROOT=$(pwd)

rm -rf coverage .coverage-raw .coverage-docker
mkdir -p .coverage-docker/asset-proxy .coverage-docker/cache-proxy

# Build proxy so the Docker containers can run compiled JS with source maps.
pnpm -w run build

# (Re)start containers in coverage mode — runs built JS instead of tsx --watch.
NODE_V8_COVERAGE=/coverage docker compose up -d --wait asset-proxy cache-proxy

# Run all tests with vitest coverage. vitest-monocart-coverage outputs raw V8
# data to .coverage-raw/vitest/ (configured in mcr.config.mjs).
pnpm exec vitest run --coverage "$@"

# Stop containers so Node flushes NODE_V8_COVERAGE data to the mounted volumes.
docker compose stop asset-proxy cache-proxy

# Collect raw V8 coverage from Docker containers and remap container paths to
# host paths so monocart can locate the source files and their source maps.
mkdir -p .coverage-raw/server
cp .coverage-docker/asset-proxy/*.json .coverage-raw/server/ 2>/dev/null || true
cp .coverage-docker/cache-proxy/*.json .coverage-raw/server/ 2>/dev/null || true

if compgen -G ".coverage-raw/server/*.json" > /dev/null; then
  sed -i '' "s|file:///app/|file://${REPO_ROOT}/|g" .coverage-raw/server/*.json
fi

# Merge all raw V8 coverage into a single report.
node scripts/merge-coverage.mjs .coverage-raw/vitest .coverage-raw/server

echo ""
echo "Coverage report written to coverage/"

# Restart containers in normal dev mode (tsx --watch).
docker compose up -d asset-proxy cache-proxy
