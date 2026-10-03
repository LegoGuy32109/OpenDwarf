---
status: accepted
---

# A rarely deployed shell serves builds from commits

The site server becomes a small shell. A build is the game client at one git
commit. The shell serves a build's page at `/b/<name>` and loads its files from
jsDelivr (`cdn.jsdelivr.net/gh/LegoGuy32109/OpenDwarf@<sha>/`), which serves
JavaScript with a module MIME type and caches a commit forever. A label names a
branch or a commit; `/` serves main, a commit saved by a promotion through the
CLI. Labels, promotions, shell deploys, live sessions, and telemetry live in
Turso. Signaling moves to Xirsys session channels, so peers no longer exchange
offers through the shell, and Deno KV is removed. The shell keeps a versioned
API (`/api/v1`) for session start, join, heartbeat, QR codes, and telemetry.

Deno Deploy allowed 15 builds an hour, and every client change needed a deploy,
so previews and production were refused while many tickets landed. With this
design a client change needs only a push. The shell is deployed only when its
own code changes.

Considered and rejected:

- Storing build files in Turso or R2: an upload step and a proxy for every file,
  when jsDelivr already serves every pushed commit.
- `raw.githubusercontent.com`: it serves JavaScript as `text/plain` with
  `nosniff`, so module scripts fail.
- Keeping signaling in the shell with KV: it works, but Xirsys already relays
  signaling for our account and keeps network traffic off the shell.
- Signaling over public relays (Trystero, PeerJS cloud, public MQTT): no uptime
  promise, and a second vendor beside Xirsys.

Consequences:

- A commit must be pushed to the public repo before it can be a build.
- Builds before the switch cannot run on the new shell.
- `deno task dev` serves the working tree as the build `local`, with a local
  WebSocket relay that speaks the Xirsys signaling format, so development and
  e2e need no internet.
- A Xirsys token must be used before it expires, but an open connection outlives
  it (tested 2026-10-03: a 30 s token kept its socket for 170 s). A reconnect
  asks the shell for a new token.
