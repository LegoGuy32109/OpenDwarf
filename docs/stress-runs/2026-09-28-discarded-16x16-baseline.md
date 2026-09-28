# Discarded 16×16 baseline — 2026-09-28

This run is retained as a harness failure record. It does not establish
15-minute movement sync.

- Revision: `66f5cc0` with uncommitted networking and harness changes.
- Host: Linux x86_64, Chromium 152.0.7977.82, one machine.
- Profile: 16×16 world, 20 joined guests, five WebGL pages including host, 50 ms
  game-message delivery delay each way, 900-second hold.
- Route: all 20 peers used local `host/host` ICE candidates.
- Host data-channel payload: 1.10 GB total, 1.13 MB/s average during hold, 5.40
  MB/s sampled peak. Queued bytes peaked at 473 KB.
- Chat checks: 136 of 136 passed. The 42 accepted-move samples above 0.25 tile
  occurred within the first 100 seconds.

After submitting chat, the runner pressed Escape. Chat submission had already
closed the input, so Escape opened the game menu and blocked later movement for
that guest. A separate event-bubbling bug also opened the menu when Escape was
used to cancel a draft. Both were fixed before the baseline was repeated. The
upload and chat measurements describe this run, but the visual-sync and movement
result cannot be used as a sustained-session result.

Raw samples and the original generated report are in ignored
`exports/stress/2026-09-28T21-31-25-042Z/` on the test machine.
