#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
node _verify/check-2d.mjs
