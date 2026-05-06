#!/usr/bin/env bash
set -euo pipefail

python_bin=""
candidates=()

if [[ -n "${PYTHON:-}" ]]; then
  candidates+=("$PYTHON")
else
  candidates+=(".venv/bin/python" "python3")
fi

for candidate in "${candidates[@]}"; do
  if [[ -x "$candidate" ]] || command -v "$candidate" >/dev/null 2>&1; then
    if "$candidate" -c "from skyfield.api import Loader" >/dev/null 2>&1; then
      python_bin="$candidate"
      break
    fi
  fi
done

if [[ -z "$python_bin" ]]; then
  echo "Skyfield is not available to any candidate Python."
  echo "Standard setup: python3 -m venv .venv && .venv/bin/python -m ensurepip && .venv/bin/python -m pip install -r requirements.txt"
  echo "Nix setup: nix-shell"
  exit 1
fi

"$python_bin" backend/server.py &
api_pid=$!

cleanup() {
  kill "$api_pid" 2>/dev/null || true
}
trap cleanup EXIT

npm run dev
