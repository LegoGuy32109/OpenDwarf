#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"
export OD_BLESS_GOLDENS=1
cargo test --manifest-path game_engine/Cargo.toml -p od_ui --test draw_goldens
