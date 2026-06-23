#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/dtcc-atlaspp-mvp"

if [ ! -d node_modules ]; then
  npm install
fi

if [[ "$(uname)" == "Darwin" ]]; then
  echo "Note: for the chrome-free projector display, run ./run-projector.sh instead." >&2
fi

npm run dev
