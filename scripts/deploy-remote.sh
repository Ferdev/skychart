#!/usr/bin/env bash
set -Eeuo pipefail

: "${DEPLOY_ENV:?DEPLOY_ENV is required}"
: "${DEPLOY_PATH:?DEPLOY_PATH is required}"

RELEASE_SHA="${GITHUB_SHA:-$(git rev-parse HEAD)}"
RELEASE_DIR="$DEPLOY_PATH/releases/$RELEASE_SHA"
CURRENT_LINK="$DEPLOY_PATH/current"
SHARED_ENV="$DEPLOY_PATH/.env"

mkdir -p "$DEPLOY_PATH/releases" "$DEPLOY_PATH/shared"

if [ -f "$SHARED_ENV" ]; then
  set -a
  # shellcheck disable=SC1090
  . "$SHARED_ENV"
  set +a
fi

if [ -n "${PHX_HOST:-}" ]; then
  export PHX_HOST
fi

export MIX_ENV=prod
export PHX_SERVER=true
export NODE_ENV=production

cd "$RELEASE_DIR"

if [ -f requirements.txt ]; then
  python3 -m venv .venv
  .venv/bin/python -m pip install --upgrade pip
  .venv/bin/python -m pip install -r requirements.txt
fi

npm ci
npm run build:phoenix

cd backend_phoenix
mix deps.get --only prod
mix compile
mix ecto.migrate

if mix help starsmap.import_catalogs >/dev/null 2>&1; then
  mix starsmap.import_catalogs "$RELEASE_DIR"
fi

ln -sfn "$RELEASE_DIR" "$CURRENT_LINK.next"
mv -Tf "$CURRENT_LINK.next" "$CURRENT_LINK"

if [ -n "${PYTHON_SERVICE:-}" ]; then
  sudo systemctl restart "$PYTHON_SERVICE"
fi

if [ -n "${PHOENIX_SERVICE:-}" ]; then
  sudo systemctl restart "$PHOENIX_SERVICE"
fi

if [ -n "${PYTHON_SERVICE:-}" ]; then
  sudo systemctl --no-pager --full status "$PYTHON_SERVICE"
fi

if [ -n "${PHOENIX_SERVICE:-}" ]; then
  sudo systemctl --no-pager --full status "$PHOENIX_SERVICE"
fi
