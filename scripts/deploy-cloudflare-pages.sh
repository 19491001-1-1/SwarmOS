#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

PROJECT_NAME="${CLOUDFLARE_PAGES_PROJECT:-xoxiang-web}"
BRANCH="${CLOUDFLARE_PAGES_BRANCH:-main}"
API_BASE="${VITE_API_BASE:-https://xoxiang-hub.xingke0.workers.dev}"
DIST_DIR="$ROOT/packages/web/dist"

log() {
  printf '[pages] %s\n' "$*"
}

log "Project: $PROJECT_NAME"
log "Branch: $BRANCH"
log "API base: $API_BASE"

log "Checking Cloudflare authentication..."
pnpm --dir "$ROOT" --filter @mini-slock/cloudflare exec wrangler whoami >/dev/null

log "Building web UI..."
VITE_API_BASE="$API_BASE" pnpm --dir "$ROOT" --filter @mini-slock/web build

log "Deploying $DIST_DIR to Cloudflare Pages..."
set +e
deploy_output="$(
  pnpm --dir "$ROOT" --filter @mini-slock/cloudflare exec wrangler pages deploy "$DIST_DIR" \
    --project-name "$PROJECT_NAME" \
    --branch "$BRANCH" \
    --commit-dirty=true 2>&1
)"
deploy_status=$?
set -e

printf '%s\n' "$deploy_output"

if [[ $deploy_status -ne 0 && "$deploy_output" == *"Project not found"* ]]; then
  log "Cloudflare Pages project '$PROJECT_NAME' does not exist. Creating it..."
  pnpm --dir "$ROOT" --filter @mini-slock/cloudflare exec wrangler pages project create "$PROJECT_NAME" \
    --production-branch "$BRANCH"

  log "Retrying Pages deploy..."
  pnpm --dir "$ROOT" --filter @mini-slock/cloudflare exec wrangler pages deploy "$DIST_DIR" \
    --project-name "$PROJECT_NAME" \
    --branch "$BRANCH" \
    --commit-dirty=true
elif [[ $deploy_status -ne 0 ]]; then
  exit "$deploy_status"
fi
