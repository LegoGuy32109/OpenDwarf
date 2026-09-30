# Split transport and motion rate comparison

Protocol version 2 separates reliable state/chat/input from unordered motion
with zero retries. Validation, attempt/view/sight fencing, a 300 ms settling
tail, and current-state backpressure coalescing are implemented.

The default remains 10 Hz. Selecting a new default requires Josh's review.
Terrain/visibility deltas, binary encoding, motion deltas, and input replay
remain deferred. The full 15-minute group run follows rate selection.

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
Initial placement is excluded from correction counters.

## Results

| Profile | World | Requested / observed motion Hz | Payload MB/s | Reliable / motion MB/s | Frame p95 ms | Peak queue KB | Paused samples % |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| final | 16×16 | 10 / 9.9 | 2.170 | 1.212 / 0.957 | 35.3 | 344 | 0.62 |
| final | 16×16 | 20 / 15.8 | 2.742 | 1.183 / 1.559 | 39.7 | 375 | 1.26 |
| final | 32×32 | 10 / 5.9 | 2.687 | 2.107 / 0.581 | 92.4 | 615 | 19.10 |
| final | 32×32 | 20 / 6.2 | 2.469 | 1.888 / 0.580 | 111.7 | 610 | 20.04 |
| loss | 16×16 | 10 / 9.8 | 2.208 | 1.243 / 0.965 | 39.3 | 343 | 1.13 |

## Interpretation

The primary 16×16 20 Hz run uses more payload and CPU without a demonstrated
motion improvement. In 32×32, CPU limits lower achieved motion rate and payload;
less payload there does not prove a more efficient protocol. Full reliable
terrain and sight updates remain a substantial cost. Stage 1 measurements
are in [the earlier report](2026-09-30-protocol-stage1.md).

Recommendation: keep the existing 10 Hz default for this implementation. Review
the supplemental loss, rendering, and master results before finalizing the rate.
The next optimization should have its own design and measurements.

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

- `2026-09-30T15-49-37-331Z`: split-final, world 16, 10 Hz, 20/20 moving, 3/3 chat checks, 0 failures. Corrections 2786, maximum gap 1.189 tiles.
- `2026-09-30T15-50-57-278Z`: split-final, world 16, 20 Hz, 20/20 moving, 3/3 chat checks, 0 failures. Corrections 2694, maximum gap 1.117 tiles.
- `2026-09-30T15-52-17-192Z`: split-final, world 32, 10 Hz, 20/20 moving, 3/3 chat checks, 0 failures. Corrections 2770, maximum gap 1.346 tiles.
- `2026-09-30T15-53-38-011Z`: split-final, world 32, 20 Hz, 20/20 moving, 3/3 chat checks, 0 failures. Corrections 2720, maximum gap 1.605 tiles.
- `2026-09-30T15-55-28-517Z`: split-loss, world 16, 10 Hz, 20/20 moving, 3/3 chat checks, 0 failures. Corrections 2657, maximum gap 1.097 tiles.

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
