# Phone connection test

The desktop hosts the world at `/`. The phone joins at `/phone-test`. Keep both
tabs open while changing the phone between Wi-Fi and cellular data.

The phone page shows a random 32-character test code. Share that code with the
person running the test. The test runner can request only four actions: sample
connection metrics, join a world, switch direct or forced TURN, and drop the
WebRTC peer to test recovery. The code expires 30 minutes after the phone stops
polling. Close the tab to stop the phone from polling for commands.

1. Open `/` on the desktop. Open `/phone-test` on the phone and share its code.
2. Join the desktop world from the phone's list. The test runner can also send
   `join` to select the first active world.
3. Record the selected ICE route, join time, median RTT, p95 RTT, and whether
   movement snaps. Test direct and forced TURN on Wi-Fi.
4. Turn off phone Wi-Fi. Keep the phone test tab in the foreground. Repeat the
   two routes on cellular.
5. Drop the peer on each network. Check that the phone rejoins automatically,
   preserves its name and tile, and shows at most five seconds of an absent
   sprite on the host.

The test runner sends `POST /api/phone-test/<code>/command` with JSON such as
`{"kind":"sample"}` or `{"kind":"relay","data":"1"}`. Use `"0"` for a normal ICE
route. `GET /api/phone-test/<code>/state` returns the latest result. Commands
are limited to `sample`, `join`, `relay`, and `drop`. The result reports ICE
candidate types and round-trip measurements without candidate addresses. For a
five-second sprite expiry check, send `{"kind":"drop","data":"6500"}`. The phone
waits 6.5 seconds before it sends a fresh join request.

The RTT comes from a data-channel ping. It measures a round trip through the
current route. The deterministic 20, 50, 100, and 200 ms tests cover movement
ordering, jitter, and a lost first send. They do not measure a cellular radio.

## What this test decides

Use one desktop host and one phone for each comparison. Record the phone model,
browser, network, ICE route, join time, median RTT, p95 RTT, and ping sample
count. The route and RTT appear on the phone panel and in the returned sample.
Record whether the first move responds promptly, whether any later move snaps
back, and how long the remote sprite disappears after a forced drop. Those
visual observations are manual; the current page does not time them.

Compare the same pair of devices on Wi-Fi and cellular, with normal ICE and
forced TURN. A normal join can also select a relay. Use the reported ICE route
when interpreting a result, not the query parameter alone. Repeat a failed join
and keep the failure result. A missing RTT sample means the data channel did not
produce a round trip; it does not mean zero latency.

The browser host owns the world and can respond to its own input on the next 50
ms simulation tick. A joining player's browser predicts its move while the host
validates the intent and sends snapshots. Watch for a correction after a
rejected move or a delayed snapshot. The Deno instance serves files, presence,
ICE credentials, and signaling through KV. It does not simulate the world. The
phone test compares one joining player with a browser host. The local browser
test also checks a host with two joining tabs. Neither test measures a
dedicated remote world server.

If joining is slow or fails, inspect the ICE route and TURN setup first. If
movement feels slow despite a fast local response, compare p95 RTT with the
median and inspect corrections. If reconnection changes the player's name or
tile, fix session recovery before tuning animation. Test accidental movement
near the center of both sticks and all eight directions on a real phone; the
browser test checks the deadzone and direction mapping in Chromium only.
