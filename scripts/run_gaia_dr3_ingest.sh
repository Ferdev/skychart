#!/usr/bin/env bash
set -euo pipefail

root="${GAIA_ROOT:-data/gaia-work}"
python="${GAIA_PYTHON:-$root/.venv/bin/python}"
gcc_lib="$(nix eval --raw nixpkgs#stdenv.cc.cc.lib.outPath)"
export LD_LIBRARY_PATH="$gcc_lib/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"

exec "$python" "$(dirname "$0")/download_gaia_dr3.py" ingest --root "$root" "$@"
