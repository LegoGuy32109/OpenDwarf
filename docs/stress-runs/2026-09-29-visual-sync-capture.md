# Host and peer 20 visual capture — 2026-09-29

The Playwright capture joined 20 peers to a browser host through
`https://opendwarf.joshhale.me`. The host and peer 20 rendered WebGL; the other
19 peers used the same WebRTC game client without WebGL. All 20 selected local
`host/host` ICE candidates. Game messages had 50 ms of application delivery
delay each way. The authored world was 16×16 at z 0.

Before recording, the harness placed each peer on a separate walkable cell,
removed the NPC, set both recorded views to `/master`, and matched their zoom
and camera. This makes the full group visible and avoids spawn collisions. It
does not represent a natural spawn or entity sight view. The host and peer 20
were named `Host` and `P20` to identify them in both clips.

All 20 peers and the host had **nine accepted moves each** during the movement
window. Playwright recorded each view, then the last five seconds of both
recordings were aligned at their common end. Each MP4 has 100 frames at 20 fps,
1280×800 pixels. The labeled side-by-side file is 2560×800 pixels with the same
five-second duration. The endings are approximately aligned by simultaneous
page closure; this is not hardware frame synchronization.

The clips and input manifest are in ignored
`exports/visual-sync/2026-09-29T00-26-52-510Z/` on the test machine:

- `host.mp4`
- `peer-20.mp4`
- `side-by-side.mp4`
- `manifest.json`

This gives a direct visual comparison with 20 peers moving. It does not measure
phone rendering, TURN, external network latency, or persistence of a visual gap
over a longer run. The 19 synthetic peers still sent move intents and received
snapshots over WebRTC; they did not draw WebGL frames.
