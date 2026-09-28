# Local host-only capacity probes — 2026-09-28

These five 32×32 probes used Chromium on one Linux x86_64 machine. Only the
host rendered WebGL; all guests still ran the game client and connected through
WebRTC. They used revision `4ff447c`; the working tree was marked dirty only
because the 32×32 report was being written. Each guest joined through a direct
session link. All selected local `host/host` ICE candidates. The base profile
added 50 ms of game-message delivery delay each way.

| Profile | Hold | Joined | Host rolling frame median / p95 | Hold payload average | Peak queue | Chat checks |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 20 peers, base | 120 s | 20/20 | 36.1 / 59.7 ms | 5.28 MB/s | 552 KB | 18/18 |
| 40 peers, base | 60 s | 40/40 | 62.9 / 105.9 ms | 5.54 MB/s | 1.33 MB | 6/6 |
| 60 peers, base | 30 s | 60/60 | 57.1 / 114.1 ms | 5.27 MB/s | 2.30 MB | 2/2 |
| 80 peers, base | 30 s | 80/80 | 63.9 / 162.2 ms | 5.63 MB/s | 3.24 MB | 2/2 |
| 20 peers, ±20 ms jitter and 1% app drop | 120 s | 20/20 | 39.9 / 50.5 ms | 5.38 MB/s | 556 KB | 20/20 |

All probes had accepted guest movement during every hold minute and no reported
join, reconnect, or page failure. The 80-peer ramp took about 142 seconds,
versus about 12 seconds for the 20-peer base ramp. It reached 80 without a
failed join, so **80 is the last tested join count, not a capacity limit**.
The longest recorded single host frames were 600, 683, 800, and 900 ms as
the base count rose from 20 to 80. The sampled queue grew with peer count;
none of these short holds establishes long-term queue stability above 20.

The host's own rendered guest sprites stayed within 0.25 tile of its world
state in the accepted-move comparisons. The probes had no guest WebGL renderers,
so they make no claim about guests' views of other players or opacity fades.
The higher payload rate at 20 peers than in the five-renderer 15-minute run
reflects the faster host loop; these are different machine-load profiles.
Jitter and loss were applied to game-message delivery inside the client,
not to ICE packets or physical networking. Same-machine data-channel byte counts
estimate payload, not external uplink.

Raw samples are in ignored `exports/stress/` directories:

- 20 peers, base: `2026-09-28T22-56-17-425Z/`.
- 40 peers: `2026-09-28T22-58-41-739Z/`.
- 60 peers: `2026-09-28T23-00-32-329Z/`.
- 80 peers: `2026-09-28T23-02-19-146Z/`.
- 20 peers with jitter and loss: `2026-09-28T23-05-25-743Z/`.
