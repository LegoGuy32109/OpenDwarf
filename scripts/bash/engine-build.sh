#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

bash scripts/bash/engine-abi-gen.sh
rm -rf static/engine
mkdir -p static/engine

cd "$ROOT_DIR/game_engine"
cargo build --manifest-path Cargo.toml --target wasm32-unknown-unknown --release -p od_wasm

wasm-bindgen \
  --target web \
  --out-dir "$ROOT_DIR/static/engine" \
  "$ROOT_DIR/game_engine/target/wasm32-unknown-unknown/release/od_wasm.wasm"

mkdir -p "$ROOT_DIR/engine/generated"
cp "$ROOT_DIR/static/engine/od_wasm.js" "$ROOT_DIR/engine/generated/od_wasm.js"
cp "$ROOT_DIR/static/engine/od_wasm_bg.wasm" "$ROOT_DIR/engine/generated/od_wasm_bg.wasm"
cp "$ROOT_DIR/static/engine/od_wasm_bg.wasm.d.ts" "$ROOT_DIR/engine/generated/od_wasm_bg.wasm.d.ts" || true
cp "$ROOT_DIR/static/engine/od_wasm.d.ts" "$ROOT_DIR/engine/generated/od_wasm.d.ts" || true

if command -v wasm-opt >/dev/null 2>&1; then
  wasm-opt -O4 \
    --strip-debug \
    "$ROOT_DIR/static/engine/od_wasm_bg.wasm" \
    -o "$ROOT_DIR/static/engine/opt_od_wasm.wasm" \
    --enable-sign-ext \
    --enable-nontrapping-float-to-int
  mv "$ROOT_DIR/static/engine/opt_od_wasm.wasm" "$ROOT_DIR/static/engine/od_wasm_bg.wasm"
fi

if command -v brotli >/dev/null 2>&1; then
  brotli -q 11 "$ROOT_DIR/static/engine/od_wasm_bg.wasm" -f -o "$ROOT_DIR/static/engine/od_wasm_bg.wasm.br"
fi

cp "$ROOT_DIR/static/engine/od_wasm.js" "$ROOT_DIR/engine/generated/od_wasm.js"
cp "$ROOT_DIR/static/engine/od_wasm_bg.wasm" "$ROOT_DIR/engine/generated/od_wasm_bg.wasm"
cp "$ROOT_DIR/static/engine/od_wasm_bg.wasm.d.ts" "$ROOT_DIR/engine/generated/od_wasm_bg.wasm.d.ts" || true
cp "$ROOT_DIR/static/engine/od_wasm.d.ts" "$ROOT_DIR/engine/generated/od_wasm.d.ts" || true
