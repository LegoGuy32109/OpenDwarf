# Sustained 20-peer protocol check

Josh selected 10 Hz after the short comparisons. The live implementation is
`11e4eea`, followed by report-only commit `f82280a`. This run records revision
`f82280a` with dirty flag `True`. Runtime files stayed unchanged throughout the
run. Only documentation changed during the hold.

## Workload

Twenty guests, host plus four rendered guests, 16×16 entity view, requested 10
Hz, seed 9, 50 ms application delivery delay per browser, no jitter/loss. The
moving hold lasted 900.7 seconds after all peers joined. Chromium version
`153.0.8010.52` ran on one Linux machine using software WebGL. The other 16
guests used the synthetic connection mode without WebGL.

## Results

| Measurement                                 |        Result |
| ------------------------------------------- | ------------: |
| Joined and moving peers                     |  20/20, 20/20 |
| Minimum connected peers in sampled hold     |            20 |
| Samples with a lost connection              |             0 |
| Reported failures                           |             0 |
| Chat checks                                 |           3/3 |
| Observed motion updates per peer per second |          9.63 |
| Aggregate payload MB/s                      |         2.188 |
| Reliable / motion payload MB/s              | 1.209 / 0.979 |
| Peak queued KB across both channels         |           400 |
| Host rolling mean frame p50 / p95 ms        |   45.4 / 50.1 |
| Longest recorded frame ms                   |         333.2 |
| Actual authoritative x/y movement intervals |        257303 |
| Fast remote visual steps                    |             0 |
| Observer sampling gaps over 200 ms          |             0 |
| Prediction corrections                      |         39518 |
| Largest correction gap in tiles             |         1.437 |

Peers moving in each complete minute of the 15-minute hold: 20, 20, 20, 20, 20,
20, 20, 20, 20, 20, 20, 20, 20, 20, 20. The final settling interval after the
hold is excluded.

## What this checks

This is a sustained movement and connection check of the selected rate. All
channel counters, frame samples, and host/observer traces remain in ignored
`exports/benchmarks/2026-09-30T16-08-19-564Z/report.json`.

Same-machine payload is not physical uplink. Frame p95 aggregates rolling mean
frames. Paused samples include intentional presentation delay around turns and
stops. Correction counters measure existing prediction behavior, with initial
placement excluded. Input replay was not added.

Josh reports that the live build looks right while testing phone and
host/controller responsiveness. No device timing measurements were supplied. The
benchmarked implementation passed 70 unit tests and 26 browser tests. Final
verification passed 71 unit tests and 26 browser tests. The additional
regression test requires the local player to be an actual snapshot entry,
excluding inherited object properties. This validation change rejects malformed
snapshots and does not alter valid traffic.

The implementation and comparison-report pushes passed CI. The deployed runtime
matched local files. CI and served files are checked after each push.

## Repeat

```sh
deno run -A scripts/benchmark-motion.ts --url=http://127.0.0.1:8000 --count=20 --rendered=4 --duration=900 --world=16 --rate=10 --seed=9 --label=split-sustained
```

See [the rate comparison](2026-09-30-protocol-split.md) for larger-world,
master-view, rendering-stress, and loss/jitter limits. Terrain/visibility
optimization, motion deltas, binary encoding, and input replay remain deferred.
