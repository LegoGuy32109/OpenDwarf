# Testing and evidence

```sh
deno task verify
deno task e2e
deno task hooks
```

`verify` checks formatting, lint, types, and deterministic world tests. The Git
pre-push hook runs the same task. CI also runs Playwright in Chromium. The
Playwright tests compare desktop and phone screenshots and exercise the WebRTC
connection. Run `deno task e2e --grep 'host and two joining tabs'` to check one
host, two joining tabs, and each tab's view of remote movement on this machine.
The shared tests also replay delayed and reordered snapshots with a fixed
schedule. A system Chromium installation is used locally when present.

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
