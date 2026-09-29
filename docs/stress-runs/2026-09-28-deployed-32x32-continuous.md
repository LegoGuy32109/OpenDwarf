# Deployed 32×32 continuous hold — 2026-09-28/29 UTC

- Client revision: `a21cff0`; Deno Deploy log revision: `4d456vnccbwr`.
  Linux x86_64 laptop, Chromium 152.0.7977.82, one machine. CI passed for
  the pushed branch, and the served client file matched the branch by hash.
- Profile: `https://opendwarf.joshhale.me`, 32×32 authored area, 20 guests
  through direct links, only the host rendering WebGL, seed 1. Application
  messages had 50 ms delivery delay each way. No added jitter or loss. A
  temporary `systemd-inhibit` process kept the laptop awake during the hold.
- The join ramp reached 1, 5, 10, then 20 peers. All 20 connected, remained
  present through the 900-second hold, and used local `host/host` ICE routes.
  This was the last stable count tested in the deployed profile; no failing
  join count was reached. Accepted guest movement occurred in all 15 hold
  minutes. There were no data-channel counter resets or runner failures.
- Wall-clock hold was 901.5 seconds. The largest gap between samples was 3.38
  seconds. The system journal has no suspend entry during this run.
- Host data-channel payload totaled 3.536 GB, averaging 3.898 MB/s (31.2
  Mb/s) during the hold with a sampled peak of 11.046 MB/s. Per-peer totals
  ranged from 170.2 to 182.9 MB. Aggregate queued bytes peaked at 554 KB.
- The host's rolling mean frame interval had a 64.7 ms median and 73.1 ms
  p95; the longest recorded single frame was 266.7 ms. This is about 14–15
  FPS on the shared test machine. All 106 typing, deletion, and chat bubble
  checks passed; their p95 measured latency was 333 ms.
- The host's rendered guest sprites stayed within 0.25 tile of host state in
  all 18,082 comparable accepted-move samples. The largest gap was 0.146 tile.
  There were no sampled opacity jumps without a sight change. Guest renderers
  were disabled, so this run does not measure a guest's view of another entity
  or local prediction lead. Rejected-move corrections were excluded.
- Deno Deploy returned 1,969 test-marked structured telemetry entries for
  this session across 21 participants in three bounded log windows. They
  contained connection and summary entries with `hosting` or `connected`
  status; no `error` or `reconnecting` entry appeared. The session ID is
  `644ce881-ca5e-4221-ab4e-854243b01597`.

This establishes a continuous 15-minute production signaling and logging
path with 20 same-machine WebRTC guests and one WebGL host. It does not measure
physical Wi-Fi or cellular RTT, TURN, guest phone rendering, or the laptop's
external uplink. The local ICE route keeps game payload on this machine even
though code, signaling, and telemetry came from Deno Deploy. A real-device
event and guest-renderer optimization remain the next evidence gaps.

Raw samples are in ignored `exports/stress/2026-09-28T23-53-02-784Z/` on the
test machine.
