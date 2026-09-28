# Stress run reports

Create one Git-tracked Markdown report for each reviewed group stress run.
Keep videos and frame traces under ignored `exports/`. Retain raw artifacts
until the report is reviewed, then for seven more days unless a failure needs
them longer.

Use a dated filename such as `2026-09-28-local-baseline.md`. Include:

- The Git revision, deployed app revision, host machine, browser, world size,
  script seed, and delay profile.
- The duration and the player-count ramp, including the last stable count and
  first failing count.
- Average and peak host upload estimates per peer and in total, ICE routes,
  queued bytes, frame timing, and join or reconnect failures.
- Accepted-move position or opacity failures, with timestamps and paths to
  the relevant raw trace or video. Report rejected-move corrections separately.
- A short conclusion stating what this run proves and what it cannot prove.

Same-machine WebRTC byte counts estimate payload upload. They do not measure
the host laptop's external uplink. Validate that separately with real devices.
