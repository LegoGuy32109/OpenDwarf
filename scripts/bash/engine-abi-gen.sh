#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR/game_engine"

cargo run --manifest-path Cargo.toml -p od_core --bin abi-gen -- --out "$ROOT_DIR/lib/engine/abi.generated.ts"

