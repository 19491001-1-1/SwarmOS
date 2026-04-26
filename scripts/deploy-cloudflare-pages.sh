#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

PROJECT_NAME="${CLOUDFLARE_PAGES_PROJECT:-crewden-web}"
BRANCH="${CLOUDFLARE_PAGES_BRANCH:-main}"
API_BASE="${VITE_API_BASE:-https://crewden-hub.xingke0.workers.dev}"
WEB_TOKEN="${VITE_WEB_AUTH_TOKEN:-}"
APP_VERSION="${VITE_APP_VERSION:-$(git -C "$ROOT" rev-parse --short=12 HEAD 2>/dev/null || printf '1.5.1')}"
COMMIT_SHA="${VITE_COMMIT_SHA:-$(git -C "$ROOT" rev-parse HEAD 2>/dev/null || true)}"
DIST_DIR="$ROOT/packages/web/dist"

log() {
  printf '[pages] %s\n' "$*"
}

log "Project: $PROJECT_NAME"
log "Branch: $BRANCH"
log "API base: $API_BASE"
log "Web version: $APP_VERSION"

if [[ "$API_BASE" == *workers.dev* || "$API_BASE" == https://* ]]; then
  if [[ -z "$WEB_TOKEN" ]]; then
    log "ERROR: VITE_WEB_AUTH_TOKEN is required when deploying against the public Cloudflare hub."
    log "Set it via: export VITE_WEB_AUTH_TOKEN=***"
    exit 1
  fi
  log "Web auth token: configured (length=${#WEB_TOKEN})"
fi

log "Checking Cloudflare authentication..."
pnpm --dir "$ROOT" --filter @crewden/cloudflare exec wrangler whoami >/dev/null

log "Building web UI..."
VITE_API_BASE="$API_BASE" \
VITE_WEB_AUTH_TOKEN="$WEB_TOKEN" \
VITE_APP_VERSION="$APP_VERSION" \
VITE_COMMIT_SHA="$COMMIT_SHA" \
pnpm --dir "$ROOT" --filter @crewden/web build

log "Deploying $DIST_DIR to Cloudflare Pages..."
set +e
deploy_output="$(
  pnpm --dir "$ROOT" --filter @crewden/cloudflare exec wrangler pages deploy "$DIST_DIR" \
    --project-name "$PROJECT_NAME" \
    --branch "$BRANCH" \
    --commit-dirty=true 2>&1
)"
deploy_status=$?
set -e

printf '%s\n' "$deploy_output"

if [[ $deploy_status -ne 0 && "$deploy_output" == *"Project not found"* ]]; then
  log "Cloudflare Pages project '$PROJECT_NAME' does not exist. Creating it..."
  pnpm --dir "$ROOT" --filter @crewden/cloudflare exec wrangler pages project create "$PROJECT_NAME" \
    --production-branch "$BRANCH"

  log "Retrying Pages deploy..."
  pnpm --dir "$ROOT" --filter @crewden/cloudflare exec wrangler pages deploy "$DIST_DIR" \
    --project-name "$PROJECT_NAME" \
    --branch "$BRANCH" \
    --commit-dirty=true
elif [[ $deploy_status -ne 0 ]]; then
  exit "$deploy_status"
fi
