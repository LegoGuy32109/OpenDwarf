#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"
bash scripts/bash/engine-bless-goldens-native.sh
bash scripts/bash/engine-bless-goldens-browser.sh
