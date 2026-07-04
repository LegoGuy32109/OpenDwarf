#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR/game_engine"

OUT="$ROOT_DIR/lib/engine/abi.generated.ts"

# --check: verify the committed abi.generated.ts matches what od_core emits,
# without mutating the working tree. Used by engine:check / CI as the drift
# backstop for the render-command ABI (see design/render-command-abi.md §7).
if [[ "${1:-}" == "--check" ]]; then
  TMP="$(mktemp)"
  trap 'rm -f "$TMP"' EXIT
  cargo run --quiet --manifest-path Cargo.toml -p od_core --bin abi-gen -- --out "$TMP"
  if ! diff -u "$OUT" "$TMP"; then
    echo "error: lib/engine/abi.generated.ts is out of date with od_core. Run: deno task abi:gen" >&2
    exit 1
  fi
  echo "abi.generated.ts is up to date."
else
  cargo run --manifest-path Cargo.toml -p od_core --bin abi-gen -- --out "$OUT"
fi
