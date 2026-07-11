#!/usr/bin/env bash
# Stage B browser Scenario e2e (Playwright).
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

npx playwright test tests/engine-scenario.test.ts
