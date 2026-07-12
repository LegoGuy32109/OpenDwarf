#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
export ENGINE_MVP_GOLDEN_BLESS=1
npx playwright test tests/engine-mvp-golden.test.ts
