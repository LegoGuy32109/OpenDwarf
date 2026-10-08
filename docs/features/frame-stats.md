# Frame stats and lag-spike logging

The client times its own frames, shows them on F3, and reports slow ones to the
shell. The code is `src/client/frame-stats.js`. It is plain JavaScript with an
injected clock, so `tests/client/frame_stats_test.ts` tests it without a
browser.

## What it keeps

- A ring of the last 300 frame times, giving p50, p95 and max. The ring is a
  `Float32Array`, so adding a frame costs nothing and never shifts an array.
- Counters of frames over 33 ms and over 100 ms since the page loaded.
- Phase timings. `loop.js` calls `frameStats.mark(phase)` and `end()` around
  `stepWorld` (`step`), the visibility recompute (`visibility`), the display
  derivation (`display`), `currentLayout` (`layout`) and `renderer.render`
  (`render`). `frame()` is called at the top of each frame. The time between two
  frame starts includes the work of the frame before, so a slow frame is named
  after the slowest phase of that earlier frame, or `other`.
- A `PerformanceObserver('longtask')` that counts long tasks and keeps the
  longest. Safari has no `longtask` entries; the counts then stay at 0.
- A log of the last 20 frames over 100 ms:
  `{at, ms, phase, viewMode, zoom,
  chunks}`.
- The gap while a tab was hidden is dropped, not counted.

`__od.frameStats()` (harness) returns all of this, with the last frame's
`viewMode`, `zoom`, `chunks`, `quads` and `tiles` as `info`.

## F3

The first line of the F3 panel is the frame line, for a host and for a guest:

    FPS 34  p95 47  max 114  spikes 47/2  render 27.1 ms  quads 19k

`spikes` is frames over 33 ms and over 100 ms. `render` is a smoothed time of
the render phase. `quads` is `renderer.stats.quads`, which the renderer sets
after each render; until it does, the line shows `-`. Host-only lines (peers,
payload, join failures, terrain) stay host-only.

## Telemetry

Every event carries `commit` when the build commit is hex (a working tree
reports `local`, so it sends none). The 10 s summary adds `metrics`:
`frameP95Ms, spikes33, spikes100, longTasks, longestTaskMs, renderMs, quads,
zoom, master`
(`master` is 1 in master view; `quads` is left out until the renderer reports
it).

A frame over 250 ms sends a `spike` event, at most one a minute. Its `detail` is
`<slowest phase> <ms> ms`, and its `metrics` are `frameMs`, `zoom`, `master`,
`chunks`, `quads` and one `<phase>Ms` for each phase that ran. The
`script-error` and `unhandled-rejection` events carry the error's name, message
and file:line in `detail`. The shell cuts the text to 160 characters and reduces
a URL to file:line (see [sessions and signaling](sessions-and-signaling.md)).

Tests: `tests/client/frame_stats_test.ts` (the ring, counters, spike log, rate
limit) and `tests/e2e/frame-stats.spec.ts` (the summary body, one `spike` for a
forced long frame, the error detail, the F3 line).

## Reading the telemetry

The shell writes every telemetry event to the Deno Deploy log, which reaches
back about a day. `deno task telemetry` reads it with the deploy CLI
(`DENO_DEPLOY_TOKEN` in the environment) and prints one report per session:

- **Participants:** frame rate, p95 (median and worst), spike and long-task
  counts, render time, RTT, and route.
- **Host upload:** KiB/s and queued bytes.
- **Timeline:** one row per minute, with the participants over 33 ms.
- **Events:** every error, spike and connection change.

- **Range:** `--start -2h` (or an ISO time) and `--end` set it; the default is
  the last hour. `--session <prefix>` picks one session. Sessions flagged as
  tests (`?test=1`, harness pages, `deno task smoke`) are left out unless you
  pass `--all`.
- **Keep a copy:** `--save <file.jsonl>` keeps the raw lines, and
  `--file <file.jsonl>` reads them again later.
- **During a test:** `deno task telemetry --follow --save <file.jsonl>` tails
  the live log into a file.
