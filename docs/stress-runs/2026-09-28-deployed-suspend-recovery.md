# Deployed run interrupted by laptop suspend — 2026-09-28

This was intended as a 15-minute continuous production-path test. The laptop
entered system suspend at 23:26:04 UTC and resumed at 23:42:32 UTC, so it is
retained as a reconnect test rather than used as an uninterrupted load result.
The kernel and NetworkManager journals confirm the suspend and Wi-Fi shutdown.

- Served client matched revision `2510f3d` by file hash; Linux x86_64,
  Chromium 152.0.7977.82, one machine. The host loaded
  `https://opendwarf.joshhale.me`; 20 synthetic guests joined through direct
  links. Only the host rendered WebGL. The world was 32×32 with 50 ms
  application-message delivery delay each way, seed 1.
- All 20 guests joined. Before suspend, the host's data-channel byte counters
  reached 3.552 GB. All 20 connections then dropped. After resume, guests
  retried and all 20 had `host/host` routes again by the final sample. The
  runner observed no page errors; Deno Deploy telemetry did record one
  `signal-failed` and one `join-failed` event during recovery, followed by
  connected summaries for the session.
- The harness recorded 935.5 seconds of active simulation and accepted guest
  movement in each active hold minute, separated by the 16-minute suspend.
  Chat bubble checks passed 118/120. The two failures were typing-state checks
  that timed out during the interruption and reconnect period.
- The generated report's 292 MB final payload counter is **not** the total:
  WebRTC counters reset on reconnect. Summing positive per-peer intervals gives
  approximately 3.85 GB sent across the run. The harness was updated after
  this run to account for counter resets and to flag wall-clock interruptions.
- Host rolling frame interval had a 55.4 ms median and 68.2 ms p95. Peak
  aggregate send queue was 557 KB. In 20,010 comparable host-side remote
  sprite samples, none exceeded 0.25 tile; this profile did not render guests.

This demonstrates that the guests rejoined after host laptop suspend while the
tab remained open. It does not prove a continuous 15-minute production hold,
and the generated bandwidth average is invalid because of the counter reset.
Same-machine WebRTC payload is still an estimate, not measured external uplink.
Raw samples are in ignored `exports/stress/2026-09-28T23-12-07-325Z/`.
