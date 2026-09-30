# Split transport and motion rate comparison

Protocol version 2 separates reliable state/chat/input from unordered motion
with zero retries. Validation, attempt/view/sight fencing, a 300 ms settling
tail, and current-state backpressure coalescing are implemented.

Josh selected the existing 10 Hz default after reviewing these results.
Terrain/visibility deltas, binary encoding, motion deltas, and input replay
remain deferred. The [15-minute group run](2026-09-30-protocol-sustained.md)
passed after selection.

## Workload and limits

All runs use 20 connected guests, seed 9, and 50 ms application delivery delay
in each browser. Primary runs have host plus four rendered guests and a
60-second moving hold. Render stress has host plus 19 rendered guests and a
30-second hold. Master runs have host plus four rendered guests and 30 seconds.
Loss runs use ±20 ms jitter and 1% motion-message loss. State/chat/input remain
reliable. These are application delivery conditions, not physical SCTP loss.

Chromium runs all peers on one Linux host with software WebGL. Frame p95 is
the percentile of rolling mean durations. Payload is aggregate data-channel
bytes across both channels, not physical upload. High CPU load can prevent
the requested timer rate from being achieved. Counts of paused visual samples
include intentional presentation delay around turns/stops and are diagnostics,
not acceptance thresholds. The comparison uses one run per configuration.
Initial placement is excluded from correction counters. Primary runs used the
working tree based on `fd5c617`, committed as implementation `11e4eea`.
Each raw report records its exact HEAD and whether the working tree was dirty.

## Results

| Profile | World | Requested / observed motion Hz | Payload MB/s | Reliable / motion MB/s | Frame p95 ms | Peak queue KB | Paused samples % |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| final | 16×16 | 10 / 9.9 | 2.170 | 1.212 / 0.957 | 35.3 | 344 | 0.62 |
| final | 16×16 | 20 / 15.8 | 2.742 | 1.183 / 1.559 | 39.7 | 375 | 1.26 |
| final | 32×32 | 10 / 5.9 | 2.687 | 2.107 / 0.581 | 92.4 | 615 | 19.10 |
| final | 32×32 | 20 / 6.2 | 2.469 | 1.888 / 0.580 | 111.7 | 610 | 20.04 |
| loss | 16×16 | 10 / 9.8 | 2.208 | 1.243 / 0.965 | 39.3 | 343 | 1.13 |
| loss | 16×16 | 20 / 15.8 | 2.693 | 1.165 / 1.528 | 39.9 | 367 | 1.14 |
| render | 32×32 | 10 / 5.6 | 2.637 | 2.094 / 0.543 | 132.7 | 610 | 16.28 |
| render | 32×32 | 20 / 6.5 | 2.460 | 1.860 / 0.600 | 134.4 | 604 | 17.43 |
| master | 32×32 | 10 / 10.0 | 3.135 | 2.098 / 1.037 | 39.4 | 539 | 0.46 |
| master | 32×32 | 20 / 19.9 | 4.144 | 2.071 / 2.073 | 38.6 | 534 | 0.34 |

## Interpretation

The primary 16×16 20 Hz run uses more payload and CPU without a demonstrated
motion improvement. In 32×32, CPU limits lower achieved motion rate and payload;
less payload there does not prove a more efficient protocol. Full reliable
terrain and sight updates remain a substantial cost. Stage 1 measurements
are in [the earlier report](2026-09-30-protocol-stage1.md).

All ten final comparisons kept 20/20 peers moving, passed all three chat
checks, and reported zero failures. Loss and rendering stress did not show a
clear reason to increase the rate. Master view achieved both requested rates:
20 Hz increased payload from 3.14 to 4.14 MB/s, with similar frame timing and a
small change in paused samples. These results suggest the entity/sight path
contributes substantial CPU cost in the larger world. They do not isolate the
exact cost without profiling.

Recommendation: keep the existing 10 Hz default for this implementation. A
20 Hz default has not demonstrated enough benefit here to justify its extra
payload. Josh confirmed this recommendation before the final 15-minute group run. The
next optimization should have its own design and measurements.

## Verification

Formatting, lint, type checks, and 70 unit tests passed. All 26 browser tests
passed. New browser checks cover both-channel readiness, unordered/zero-retry
configuration, future-sight buffering, newest-only pending motion, old attempt
and view rejection, older state preserving newer positions, atomic malformed
snapshot rejection, incompatible versions, and chat with motion loss. Existing
checks cover reconnect, stop/reversal convergence, sight fades, master/entity
switching, phone controls, and elevation rules through shared movement tests.

The first two split-channel pilot runs are excluded from this table. Recovery
was adjusted to wait one second for a missing sight packet before requesting a
resync, and counters now exclude initial placement. Final run IDs follow.

- `2026-09-30T15-49-37-331Z` (fd5c617 dirty): split-final, world 16, 10 Hz, 20/20 moving, 3/3 chat checks, 0 failures. Corrections 2786, maximum gap 1.189 tiles.
- `2026-09-30T15-50-57-278Z` (fd5c617 dirty): split-final, world 16, 20 Hz, 20/20 moving, 3/3 chat checks, 0 failures. Corrections 2694, maximum gap 1.117 tiles.
- `2026-09-30T15-52-17-192Z` (fd5c617 dirty): split-final, world 32, 10 Hz, 20/20 moving, 3/3 chat checks, 0 failures. Corrections 2770, maximum gap 1.346 tiles.
- `2026-09-30T15-53-38-011Z` (fd5c617 dirty): split-final, world 32, 20 Hz, 20/20 moving, 3/3 chat checks, 0 failures. Corrections 2720, maximum gap 1.605 tiles.
- `2026-09-30T15-55-28-517Z` (fd5c617 dirty): split-loss, world 16, 10 Hz, 20/20 moving, 3/3 chat checks, 0 failures. Corrections 2657, maximum gap 1.097 tiles.
- `2026-09-30T15-56-48-691Z` (fd5c617 dirty): split-loss, world 16, 20 Hz, 20/20 moving, 3/3 chat checks, 0 failures. Corrections 2653, maximum gap 1.090 tiles.
- `2026-09-30T15-58-08-752Z` (11e4eea dirty): split-render, world 32, 10 Hz, 20/20 moving, 3/3 chat checks, 0 failures. Corrections 1451, maximum gap 1.579 tiles.
- `2026-09-30T15-59-14-336Z` (11e4eea dirty): split-render, world 32, 20 Hz, 20/20 moving, 3/3 chat checks, 0 failures. Corrections 1422, maximum gap 1.692 tiles.
- `2026-09-30T16-00-22-877Z` (11e4eea dirty): split-master, world 32, 10 Hz, 20/20 moving, 3/3 chat checks, 0 failures. Corrections 1563, maximum gap 0.934 tiles.
- `2026-09-30T16-01-14-608Z` (11e4eea dirty): split-master, world 32, 20 Hz, 20/20 moving, 3/3 chat checks, 0 failures. Corrections 1482, maximum gap 0.754 tiles.

Raw JSON contains all channel counters, build timings, correction totals, and
host/observer traces under ignored `exports/benchmarks/`. Correction counts are
observations of the existing prediction system. No input replay was added.

## Repeat

```sh
deno run -A scripts/benchmark-motion.ts --url=http://127.0.0.1:8000 --count=20 --rendered=4 --duration=60 --world=16 --rate=10 --seed=9 --label=split-final
```

Repeat with `--rate=20` and `--world=32`. Add `--jitter=20 --loss=0.01` for
loss, `--rendered=19 --duration=30 --world=32` for rendering stress, or
`--view=master --duration=30 --world=32` for master view. Run workloads
sequentially against a dedicated server and keep served files unchanged.
