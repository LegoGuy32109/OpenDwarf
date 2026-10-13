# Testing and evidence

```sh
deno task verify
deno task e2e
deno task hooks
```

`verify` checks formatting, lint, types, and deterministic world tests. The Git
pre-push hook and the merge gate run the same task. A nightly CI run also runs
Playwright in Chromium. The Playwright tests compare desktop and phone
screenshots and exercise the WebRTC connection. Run
`deno task e2e --grep 'host and two joining tabs'` to check one host, two
joining tabs, and each tab's view of remote movement on this machine. The shared
tests also replay delayed and reordered snapshots with a fixed schedule. A
system Chromium installation is used locally when present.

## Unit tests for a diff

```sh
deno task test:changed [--base main]
```

The task runs `deno test --changed=<base>` (default `main`) over the unit test
folders. Deno follows each test's module graph and runs only the tests that
reach a file changed in git. It cannot see a file a test reads at run time, such
as the Markdown the link check scans or the SQL the migration tests load, so
`tests/lint` and the tests that read files always run too. A doc-only change
runs only that set. `deno task verify` and the pre-push hook still run every
unit test.

Browser specs are not chosen by diff. They import almost nothing from `src/`, so
no import graph links client code to a spec, and Playwright's `--only-changed`
has the same limit. They run in two tiers instead:

- **Smoke** (`deno task e2e:smoke`, about a minute): the specs tagged
  `{ tag: "@smoke" }`, one per journey: boot and the boot-error page, a join
  through the relay and over WebRTC, the host mining, a guest placing stone, the
  phone layout, reliable chat under loss, a build under `/b/<branch>/`, and a
  phone join link. `.github/workflows/smoke.yml` runs it on every pull request
  and push to main. It is not a required check yet.
- **Full** (`deno task e2e`): every spec. `.github/workflows/e2e.yml` splits it
  across four runners with `--shard=i/4`, one worker each, nightly on main, by
  hand, and on a pull request with the `e2e` label. A failed nightly run opens
  or updates an issue. `deno task e2e --shard=1/4` runs one quarter locally. On
  a workstation it runs four workers, about 3.5 minutes for the whole suite;
  `E2E_WORKERS=n` changes that.

Neither tier blocks a merge: the merge gate in `ci.yml` is `deno task verify`. A
smoke test must stay fast; one that grows past a few seconds moves to the full
tier. A new or changed spec passes `--repeat-each=5` before it merges. A flaky
spec gets `test.fixme` and an issue, never retries.

## Interact logic coverage

`tests/client/interact_test.ts` calls `interact()` with a fake context and real
world rules. It covers mining and cancellation, view levels, sight refusals,
pickup priority, grid confirmation, placing, panel priority, and guest intents.
It needs no browser, DOM, or connected peer. World progress uses explicit ticks.

These e2e checks moved to unit tests:

| Removed e2e check                                                                                       | Unit coverage                                                                                             |
| ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Host mines, holds stone, places a wall, refuses its own tile and solid terrain, then mines placed stone | `interact_test` wall cycle and solid refusal, plus `placing_test` terrain and inventory rules             |
| Aim moves freely, interact cancels mining, and no aim refuses mining                                    | `interact_test` current aim and cancellation                                                              |
| Mining targets one level below or above while the cursor moves                                          | `interact_test` view levels and free cursor                                                               |
| Mining drops stone and coal, pickup adds inventory and a system line, and no aim refuses mining         | `interact_test` wall cycle, target replacement, pickup and cancellation, plus `items_test` material drops |
| A single stack is picked up without opening the grid                                                    | `interact_test` single stack priority                                                                     |

Peer delivery, touch input, and phone icon evidence remain in e2e. Guest intent
unit tests check messages sent by the client, not their delivery to the host.

## Browser specs wait on game time

World time follows the wall clock and drops whatever a slow frame cannot catch
up on, so a fixed sleep or a time limit lets less of the game happen on a loaded
machine or a CI runner. Specs therefore never sleep, read the clock, or set a
timeout. They wait with `tests/e2e/time.ts`, and every wait is bounded in world
ticks, so a wait that cannot succeed fails after the same amount of game on any
machine:

- poll the state they check, which is the first choice: `expect.poll` for state
  that arrives within a few frames, `waitFor(page, check, { maxTicks })` for
  game progress such as a tile being mined;
- `holdUntil(page, key, done, { maxTicks })` to walk until a position or other
  state is reached;
- `waitTicks(page, n)` when game time must pass, such as proving nothing
  happens;
- `waitFrames(page, n)` when the frame loop must read input or redraw the UI.

The default bound is 200 ticks, 10 s of game time. The only time limits are in
`playwright.config.ts`: they end a page that has hung, and a passing spec never
waits for them. Assertions count ticks, not milliseconds or frames per second.
For example, the check that remote motion is continuous allows a fixed distance
per tick between two drawn samples, so sparse frames widen the allowance instead
of failing it.

`tests/lint/e2e_wall_clock_test.ts` fails `verify` on `waitForTimeout`,
`setTimeout`, `setInterval`, `performance.now`, `Date.now`, `timeout:` or
`test.slow` in a spec. A spec about a real-time feature (a join attempt that
expires, speech revealed in real time) keeps the call with a
`// wall-clock: <reason>` comment, or uses Playwright's `page.clock`. A spec
that works on the tiles the corner NPC walks calls `__od.removeNpc()` first.

## Group stress run

For current continuous movement, start a dedicated local server and run:

```sh
deno run -A scripts/benchmark-motion.ts --url=http://127.0.0.1:8000 --count=20 --rendered=4 --duration=60 --world=16 --rate=10 --seed=9
```

The benchmark measures actual x/y movement, both channel queues and payload,
frame timing, prediction corrections, and chat delivery. The URL is required;
the script does not start a server. `--duration=900` gives a 15-minute hold. The
host and four guests render WebGL. Other guests connect without rendering. Use
`--rendered=19` for host plus 19 rendered guests, `--world=32` for the larger
world, or `--view=master` to compare master view. `--rate=20` is a harness-only
experiment. The live default remains 10 Hz pending the rate review.

By default each browser delays game-message delivery by 50 ms, approximating 100
ms round trip without changing ICE or physical packet delay. Add
`--jitter=20 --loss=0.01` for jitter and 1% replaceable motion-message loss.
Reliable state/chat/input are not dropped. These conditions do not simulate
physical SCTP loss. Reports and traces land under ignored `exports/benchmarks/`.
Run browser workloads sequentially and keep served files unchanged during a run.
Reviewed summaries belong in [stress-run reports](../stress-runs/README.md). The
older `deno task stress` runner remains for historical comparisons, but its
committed-step movement counters do not measure continuous movement correctly.

`deno task capture:sync` records a five-second visual comparison from the host
and the 20th peer against the deployed site. All 20 peers use WebRTC, while the
host and 20th peer render WebGL. The script places players on separate walkable
cells, uses `/master` and the same zoom on both views, and records randomized
movement. It writes individual and side-by-side MP4 files plus a movement
manifest under ignored `exports/visual-sync/`. Pass
`--url=http://127.0.0.1:8000` for a server already running locally or
`--delay=<milliseconds>` to change the per-message application delay.

## Evidence

A ticket with a visible change needs screenshots, and an interaction needs a
short video; `AGENTS.md` says how to capture and publish them.
