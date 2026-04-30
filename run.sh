#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/dtcc-atlaspp-mvp"

if [ ! -d node_modules ]; then
  npm install
fi

npm run dev
