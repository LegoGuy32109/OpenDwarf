# Live session vision

Status: working design. This records choices Josh confirmed in the grilling
session. It is not an implementation specification.

## Intended smoke test

Josh runs the world host in a laptop browser and mirrors his player view to a
TV over HDMI. A QR code gives guests a direct link to that session. Twenty
phones joining alongside Josh is the first performance milestone, with no
fixed player cap. Everyone can move at once.

The first group test uses an authored 32×32 area built from four 16×16 chunks.
Each chunk spans the same eight view levels as the current world and has a
stable identity. All four load when a guest joins; distance-based loading and
generation wait. The QR link is the normal way to join a specific session,
while `/admin` continues to list active worlds for development.
Joining players appear across walkable tiles in a spawn chunk. Several may
appear on the same tile. Normal movement still blocks entry into an occupied
tile. Any player can use `/master` as a development tool.
Phones may connect over the venue's Wi-Fi or cellular network. Closing the
host's tab may end the session. A joining phone should still recover from a
brief connection drop while the host remains open. Its sprite may disappear
after five seconds offline, while its place remains reserved for one minute.
The host can show a large join QR code before play and on demand, with a small
player count during play. A toggleable diagnostics panel shows host frame rate,
estimated upload, queued bytes, and join failures.
Guests join unnamed and can choose a name with `/nick`.

This stage tests whether a browser-hosted WebRTC world supports a live group
adventure. The immediate stress run uses movement, chat, and human-paced
typing that shows and clears typing bubbles. It does not require world
interaction or item manipulation.

The 15-minute group stress run is a simulated experience that measures
performance and visual sync. It is a planning target, not a required CI test.
Run a network and rendering baseline in the current 16×16 world, then repeat
after the authored 32×32 area exists. Ramp through 1, 5, 10, and 20 joining
players, hold at 20, then keep adding players to find the practical limit.
The host and simulated guests run on the same machine. No more than 20 pages
render WebGL at once, including the host. Extra synthetic peers still
participate through WebRTC so the test can measure host upload as load grows.
Start with about 100 ms round-trip delay, then repeat with jitter and
occasional loss.

Dry-run locally, then run the recorded 15-minute test against the deployed
site so Deno Deploy captures signaling and opted-in diagnostics. Mark stress
sessions in logs. Measure average and peak host payload upload per peer and in
total, the selected ICE route, and queued bytes. Treat same-machine WebRTC
bytes as an upload estimate; use a smaller real-device check to validate
actual external upload.

Stop adding synthetic peers when joins fail repeatedly, the host becomes
unresponsive, or its send queue grows without draining. Record the last stable
and first failing player counts. Keep accepted-move visual failures separate
from expected corrections after rejected moves. Flag an accepted-move sprite
that stays more than a quarter tile from its expected position for over
100 ms, or whose opacity jumps without a sight change.

Scripts move, pause, reverse, use stairs, type and delete drafts at a human
pace, and submit chat. Opted-in clients report periodic performance summaries
and immediate errors to Deno Deploy without chat text or drafts. Agents should
be able to read recent device, game, and network failures. The run records
host positions, client-rendered positions and opacity, and short browser
videos around visual outliers. Each run leaves a Git-tracked summary; raw
traces and videos stay under ignored `exports/` until Josh reviews the report.
Retain them for seven more days, or longer while an open failure needs them.
Measure draft-to-typing-bubble and submit-to-chat-bubble timing on other
clients, and check that clearing a draft removes its typing bubble. Use event
IDs and timings in diagnostics without recording chat content.

## Later interaction path

1. Add destructive terrain edits without collectible material.
2. Resolve the inventory UI before adding inventory behavior.
3. Make terrain deletions create rock entities that players can manage in
   inventory.
4. Let players switch what they hold between a pickaxe and a rock.
5. Let players place held rock, creating additive terrain edits.

## Status

The interview has resolved the live-session vision and stress-run behavior.
Implementation details and performance limits need evidence from the run.
