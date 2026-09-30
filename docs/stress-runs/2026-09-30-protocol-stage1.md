# Protocol stage 1 measurements

The filtering extraction reduces unnecessary CPU work. It does not reduce the
full reliable terrain payload or eliminate reliable motion queueing.

## Workload

Baseline: `a015db9`. Comparison: entity filtering extraction, send/build timing,
and incomplete join deadline. Each run used 20 guests, host plus four rendered
guests, entity view, 10 Hz motion, 50 ms application delivery delay in both
browsers, no loss/jitter, seed 9, and a 60-second sustained movement hold.
All 20 peers moved in every run. All three chat checks passed with no page
errors, join failures, or connection losses.

| Build | World | Payload MB/s | Host rolling mean frame p95 ms | Peak queued KB |
| --- | --- | ---: | ---: | ---: |
| Baseline | 16×16 | 2.597 | 52.7 | 415 |
| Filtering | 16×16 | 2.886 | 43.8 | 404 |
| Baseline | 32×32 | 2.554 | 91.3 | 550 |
| Filtering | 32×32 | 2.925 | 87.3 | 647 |

These are single matched runs on one machine using software WebGL. Frame p95 is
an aggregate of rolling mean frame durations, not the percentile of individual
frames. Payload is aggregate data-channel bytes, not physical network upload.
A faster host can send more updates under the same wall-clock workload, which
can increase payload. Repeat measurements before claiming a stable percentage
gain. Reliable queue pressure remains substantial.

The older stress runner counts committed tile steps and does not detect current
continuous x/y movement. The new `scripts/benchmark-motion.ts` uses actual x/y
traces and an explicit server URL to avoid measuring an unintended local server.
An earlier run through the old runner was discarded for both reasons.

## Repeat

```sh
deno run -A scripts/benchmark-motion.ts --url=http://127.0.0.1:8000 --count=20 --rendered=4 --duration=60 --world=16 --rate=10 --seed=9 --label=filtering
```

Repeat with `--world=32`. Run browser workloads sequentially. Raw reports and
traces are under ignored `exports/benchmarks/`. Recorded run IDs:

- Baseline16: `2026-09-30T15-25-08-656Z`, in the isolated baseline worktree.
- Baseline32: `2026-09-30T15-26-38-844Z`, in the isolated baseline worktree.
- Filtering16: `2026-09-30T15-30-47-518Z`.
- Filtering32: `2026-09-30T15-32-26-627Z`.

## Verification and next stage

The unanswered-offer browser test verifies cleanup after ten seconds without
creating a player. Deadline unit tests cover replacement attempts and callbacks.
Established reconnect reservations remain one minute.

Next: validated versioned JSON, independent reliable chat/state/input and
unordered motion, revision fencing, then the agreed 20-peer 10/20 Hz comparison.
The default rate remains 10 Hz pending review of that comparison.
