# Admin-join load run — 2026-09-28

This run measured 20 WebRTC peers for 15 minutes, but its visual-sync comparison
used each guest's locally predicted player sprite. It therefore cannot establish
remote-sprite parity. The later direct-join runner measures remote sprites
separately and leaves local prediction lead as its own metric.

- Revision: `821e4e9`; Linux x86_64, Chromium 152.0.7977.82, one machine.
- Profile: 16×16, 20 guests joined through `/admin`, five WebGL pages including
  host, 50 ms game-message delivery delay each way, 900-second hold.
- All 20 peers used local `host/host` ICE routes. There were no join or page
  failures; 92 of 92 chat checks passed. Accepted guest moves occurred
  throughout the hold. The generated `16/15` minute count included an extra
  terminal bucket; the runner now excludes that bucket.
- Host data-channel payload: 1.98 GB total, 2.28 MB/s average during the hold,
  7.05 MB/s sampled peak. Per-peer payload was 87.8–107.3 MB. Queued bytes
  peaked at 492 KB.
- The 1,609 samples above 0.25 tile compare local prediction to host authority.
  They are **not** remote-sprite failures. No accepted-move remote-sprite or
  opacity conclusion can be drawn from this run.

This same-machine run estimates WebRTC payload, not external uplink or physical
network latency. Guests loaded the admin page, including its presence polling,
so this is not the final QR/direct-join load profile. Raw samples and clips are
in ignored `exports/stress/2026-09-28T21-52-53-475Z/` on the test machine.
