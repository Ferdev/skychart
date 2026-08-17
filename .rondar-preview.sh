#!/usr/bin/env bash
set -euo pipefail

readonly PROJECT_ROOT=/app
readonly PREVIEW_PORT=3000
readonly PHOENIX_PORT=4020
readonly API_PORT=8765
readonly LOG_FILE=/tmp/preview.log
readonly PID_FILE=/app/.rondar-preview.pid
readonly ELIXIR_VERSION=1.15.8
readonly ERLANG_VERSION=26.2.5.21

cd "$PROJECT_ROOT"

# Install only dependencies missing from a fresh preview container.
missing_packages=()
command -v psql >/dev/null 2>&1 || missing_packages+=(postgresql postgresql-client)
command -v pg_isready >/dev/null 2>&1 || missing_packages+=(postgresql-client)
command -v fuser >/dev/null 2>&1 || missing_packages+=(psmisc)
command -v python3 >/dev/null 2>&1 || missing_packages+=(python3 python3-venv python3-pip)
if ((${#missing_packages[@]})); then
  sudo apt-get update
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y "${missing_packages[@]}"
fi

sudo service postgresql start
until pg_isready -q; do sleep 1; done

if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  echo "Node.js 22+ and npm are required by this project." >&2
  exit 1
fi
if [[ ! -x node_modules/.bin/vite ]]; then
  npm ci --no-audit --no-fund
fi

if [[ ! -x .venv/bin/python ]]; then
  python3 -m venv .venv
fi
if ! .venv/bin/python -c 'import skyfield' >/dev/null 2>&1; then
  .venv/bin/python -m pip install -r requirements.txt
fi

elixir_bin="/home/dev/.local/share/mise/installs/elixir/$ELIXIR_VERSION/bin"
erlang_bin="/home/dev/.local/share/mise/installs/erlang/$ERLANG_VERSION/bin"
if [[ ! -x "$elixir_bin/mix" || ! -x "$erlang_bin/erl" ]]; then
  if ! command -v mise >/dev/null 2>&1; then
    echo "mise is required to install the project Elixir/Erlang toolchain." >&2
    exit 1
  fi
  mise install "erlang@$ERLANG_VERSION"
  mise install "elixir@$ELIXIR_VERSION"
fi
export PATH="$elixir_bin:$erlang_bin:$PATH"

mix local.hex --force
mix local.rebar --force
(cd backend_phoenix && mix deps.get)

sudo -u postgres psql -v ON_ERROR_STOP=1 -Atqc \
  "SELECT 1 FROM pg_database WHERE datname = 'starsmap_api_dev'" | grep -q 1 || \
  sudo -u postgres createdb starsmap_api_dev

(cd backend_phoenix && mix ecto.migrate)

catalog_count="$(PGUSER=postgres psql -d starsmap_api_dev -Atqc \
  "SELECT count(*) FROM catalog_objects" 2>/dev/null || printf '0')"
if [[ ! "$catalog_count" =~ ^[0-9]+$ ]] || ((catalog_count < 1000)); then
  (cd backend_phoenix && mix starsmap.import_catalogs "$PROJECT_ROOT")
fi

# Stop only prior preview processes occupying this project's assigned ports.
for assigned_port in "$PREVIEW_PORT" "$PHOENIX_PORT" "$API_PORT"; do
  if fuser "${assigned_port}/tcp" >/dev/null 2>&1; then
    fuser -k "${assigned_port}/tcp" >/dev/null 2>&1 || true
  fi
done

export PORT="$PREVIEW_PORT"
export HOST=0.0.0.0
export ATLAS_API_HOST=0.0.0.0
export ATLAS_API_PORT="$API_PORT"
export PYTHON_BACKEND_URL="http://127.0.0.1:$API_PORT"
export RONDAR_PREVIEW_HOSTS="${RONDAR_PREVIEW_HOSTS:-preview.rondar.dev,prod-preview.ferdev.com}"
export PREVIEW_URL="${PREVIEW_URL:-https://project-19.preview.rondar.dev/}"

: > "$LOG_FILE"
preview_pid=$$
printf '%s\n' "$preview_pid" > "$PID_FILE"
echo "PID: $preview_pid"

# The browser-facing Vite process starts first and provides hot reload.
node node_modules/vite/bin/vite.js --host 0.0.0.0 --port 3000 --strictPort >> "$LOG_FILE" 2>&1 &
vite_pid=$!
sleep 1

ATLAS_API_HOST=0.0.0.0 ATLAS_API_PORT=8765 \
  .venv/bin/python -u backend/server.py >> "$LOG_FILE" 2>&1 &
api_pid=$!

(
  cd backend_phoenix
  PORT=4020 PYTHON_BACKEND_URL=http://127.0.0.1:8765 exec mix phx.server
) >> "$LOG_FILE" 2>&1 &
phoenix_pid=$!

(
  while kill -0 "$preview_pid" 2>/dev/null; do
    sleep 60
    log_size=$(wc -c < "$LOG_FILE" 2>/dev/null || echo 0)
    if [[ "$log_size" -gt 10485760 ]]; then
      trim_file="${LOG_FILE}.trim.$$"
      tail -c 5242880 "$LOG_FILE" > "$trim_file" && cat "$trim_file" > "$LOG_FILE"
      rm -f "$trim_file"
    fi
  done
) &
log_limiter_pid=$!

cleanup() {
  kill "$vite_pid" "$api_pid" "$phoenix_pid" "$log_limiter_pid" 2>/dev/null || true
  wait "$vite_pid" "$api_pid" "$phoenix_pid" "$log_limiter_pid" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

wait -n "$vite_pid" "$api_pid" "$phoenix_pid"
