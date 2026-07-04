#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

# ABI drift backstop: fail if the committed abi.generated.ts no longer matches
# od_core's #[repr(C)] records (design/render-command-abi.md §7).
bash "$ROOT_DIR/scripts/bash/engine-abi-gen.sh" --check

cd "$ROOT_DIR/game_engine"
cargo check --manifest-path Cargo.toml
cargo check --manifest-path Cargo.toml --target wasm32-unknown-unknown
