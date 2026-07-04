#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

bash scripts/bash/engine-abi-gen.sh
rm -rf static/engine
mkdir -p static/engine

cd "$ROOT_DIR/game_engine"
cargo build --manifest-path Cargo.toml --target wasm32-unknown-unknown -p od_wasm

wasm-bindgen \
  --target web \
  --out-dir "$ROOT_DIR/static/engine" \
  "$ROOT_DIR/game_engine/target/wasm32-unknown-unknown/debug/od_wasm.wasm"

mkdir -p "$ROOT_DIR/engine/generated"
cp "$ROOT_DIR/static/engine/od_wasm.js" "$ROOT_DIR/engine/generated/od_wasm.js"
cp "$ROOT_DIR/static/engine/od_wasm_bg.wasm" "$ROOT_DIR/engine/generated/od_wasm_bg.wasm"
cp "$ROOT_DIR/static/engine/od_wasm_bg.wasm.d.ts" "$ROOT_DIR/engine/generated/od_wasm_bg.wasm.d.ts" || true
cp "$ROOT_DIR/static/engine/od_wasm.d.ts" "$ROOT_DIR/engine/generated/od_wasm.d.ts" || true
