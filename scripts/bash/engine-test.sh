#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR/game_engine"

cargo test --manifest-path Cargo.toml -p od_core -p od_ui -p od_world

