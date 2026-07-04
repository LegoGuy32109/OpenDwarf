#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR/game_engine"

cargo check --manifest-path Cargo.toml
cargo check --manifest-path Cargo.toml --target wasm32-unknown-unknown

