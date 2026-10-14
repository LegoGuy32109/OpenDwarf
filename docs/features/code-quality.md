# Code quality

Fallow 3.33.1 checks unused code, duplication, architecture, and function
health. Its separate security command identifies candidates that require review.

```sh
deno task arch
npx --yes fallow@3.33.1 --score
npx --yes fallow@3.33.1 security
npx --yes fallow@3.33.1 viz --out exports/handoff/fallow-viz.html
```

## Scores and scope

The full CLI score includes Git churn and hotspots. The visualization does not
load Git history. Its health capability metadata marks churn and hotspots as
`disabled`. It also rounds the stored score for display. Compare the raw scores
and their available signals before comparing grades.

The first full scan in this cleanup scored 83.2, including a 3.3-point hotspot
penalty. The visualization stored 86.5 and displayed 87. The isolated health
score command displayed 86. These displays did not measure the same signals.

A passing architecture baseline check means no new violations. An unbaselined
architecture run checks the whole graph. The cleanup removes the old violations
and reduces the architecture baseline to an empty file.

## Runtime entrypoints and Deno dependencies

The prototype HTML page is an entrypoint. It imports its stylesheet, and its
local server serves the page and files from a fixed allowlist.

`.fallow/plugins/opendwarf.json` declares the `inspectWorld` export as a runtime
hook. The Playwright driver imports it through a URL inside browser evaluation,
which static export tracking cannot resolve.

Fallow's dependency accounting looks for npm manifests. The following packages
are declared in `deno.json` and resolved through Deno's lockfile:
`@playwright/test`, `@tursodatabase/serverless`, and `qrcode-svg`.
`ignoreDependencies` lists only those package names.

The two unresolved admin asset URLs, `/admin/admin.css` and `/admin/admin.js`,
are explicit routes in `server/admin-page.ts`. `ignoreUnresolvedImports` lists
only those two URLs. It does not exempt other unresolved imports.

## Measured coverage

CRAP scores combine complexity with coverage. Without runtime data, Fallow
estimates coverage from the static test graph. Browser evaluation, injected
services, and dynamically imported modules can make that graph incomplete.

```sh
deno task test:coverage
FALLOW_BROWSER_COVERAGE=exports/coverage/browser PORT=8126 deno task e2e
```

`test:coverage` runs the unit tests and wraps Deno's per-script V8 profiles in
Fallow's input format. JavaScript offsets refer to the original source.
TypeScript profiles use Deno's cached emitted JavaScript and embedded source
maps. The adapter checks emitted lengths and original source contents before
mapping them. It decodes Unicode source maps as UTF-8.

Deno produces separate profiles for test isolates. `scripts/fallow-v8.ts` merges
those profiles by source and function range. It sums the most specific count at
each segment, including a parent's count when another isolate has no child range
there. Passing separate profiles directly to Fallow can change coverage results.
Unit tests cover nested ranges, isolate counts, Unicode maps, and stale source
rejection.

The optional browser fixture captures JavaScript coverage before pages close,
including pages created directly by a test. It records local application modules
and browser entrypoints. Anonymous evaluation scripts and historical remote
builds are excluded.

Keep the source unchanged during collection. Regenerate coverage after a code
change. A health report with partial runtime coverage must still identify the
functions that use estimated coverage.

## Security candidate review

The initial security scan reported 22 candidates. The QR join-link validator
used a dynamic regular expression. It now uses a fixed path pattern and checks
the exact session suffix.

The other 21 candidates have individual `security-sink` suppressions with a
rationale immediately above each sink:

- Client API fetches use the shell-configured HTTP(S) origin. Peer messages
  supply no destination origin. The QR URL is constructed by the same module.
- The guest redirect uses a validated build path and the page's own origin.
- The service worker forwards browser GET requests. Its dispatch gates cached
  build files and media by origin or the configured CDN pattern.
- Dashboard fetches run in the browser and use fixed API paths on its origin.
- Benchmark, stress, and smoke destinations come from the operator's CLI or
  environment. These programs do not serve HTTP requests.
- Shell deploy glob fragments are escaped before stars expand into path
  segments. The input comes from the operator-owned deploy configuration.

These are reviewed candidates, not 21 repaired vulnerabilities. The scan does
not prove that the application is secure. New sinks require a new review, and
these local suppressions do not exempt a whole module or category.

## Test fixtures

Tests share setup without hiding their expected result.
`tests/shared/fixtures.ts` provides an open chunk with a stone floor through the
world builder. `tests/client/media_fakes.ts` provides the playback cache
fixture. `tests/support/console.ts` captures log messages and restores the
console if a request or assertion fails. Reconciliation tests share world-pair
setup.

See [testing and evidence](testing-and-evidence.md) for tick waits and browser
repetitions.

## Health comparison

Commit `9cc6b14` records the cleanup before the critical and high Health pass.
The later diff keeps route handlers, packet dispatch, prediction policies,
render passes, and test scenarios in named functions. It also exposes pure
motion evidence calculations to unit tests.

Use the same Fallow version and thresholds for comparison:

```sh
npx --yes fallow@3.33.1 --score --format json
npx --yes fallow@3.33.1 health --min-severity high
```

The priority gate checks critical and high functions. Moderate findings remain
advisory. It does not suppress them, change complexity thresholds, or add a
Health baseline. A passing gate does not mean Health has no findings.

Compare function severity, maximum complexity, long functions, and score
components. Extraction can increase the function count and total cyclomatic
complexity because each helper starts at one. Git hotspot scores can also move
while the commit history stays the same. The visualization omits that signal.

Runtime coverage is a separate view. Its measured coverage can expose code that
the static test graph estimates too generously, as well as tested code the graph
misses. Keep the static and measured reports distinct.
