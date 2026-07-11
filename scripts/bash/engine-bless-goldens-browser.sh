#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"
export ENGINE_GOLDEN_BLESS=1
export ENGINE_GOLDEN_CLOUD_ARTIFACTS=1
npx playwright test tests/engine-golden.test.ts
