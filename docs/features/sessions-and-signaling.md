# Sessions and signaling

Open `http://localhost:8000/` to start a local world (see
[world and terrain](world-and-terrain.md)). Open `http://localhost:8000/host` in
another browser to see active worlds and join one. The `/host` route lists
recent visitor heartbeats and joins through a WebRTC data channel. The `/host`
route has no access control in this demo, so anyone who knows the route can list
and join active worlds in this stage, and its APIs have no authentication.
Joining has no fixed cap for stress testing; the practical limit is still being
measured. A world has one browser host, and host upload and browser performance
set the practical limit. It ends when the host closes the page. A missed close
signal leaves the session live until 45 seconds pass without a heartbeat.

The host displays a session-specific QR code for `/join/<session>`, which a
phone opens to join that world directly. The Deno server generates its SVG with
one server-side dependency; guest browser code still has no build step. `<base>`
is `/` here and the build's path, such as `/b/test/`, when the page is served as
a build (see [shell and builds](shell-and-builds.md)).

## Signaling

Peers exchange offers, answers, and the leave notice through a Xirsys session
channel, the sub-channel `<XIRSYS_CHANNEL>/<session>`
([ADR 0004](../adr/0004-shell-serves-builds-from-commits.md)). The shell holds
the Xirsys credentials. `src/server/session-routes.ts` answers:

- `POST /api/v1/sessions` with `{id, commit?, label?, hostKey?}` creates the
  channel, records the session with the host's build, and returns the host's
  `channel`, `token`, `host`, `signalUrl`, `iceServers`, and a `hostKey`. The
  host sends its `hostKey` back to get a fresh token for the same channel. The
  key is an HMAC of the session id, so the shell stores nothing. A taken id
  without its key answers 409. A build with no commit (the working tree) is
  stored as `local`.
- `POST /api/v1/sessions/<id>/join` with `{peer}` returns the same for a guest,
  and the host's `build`: `{commit, label, path}`. A session that ended answers
  404.
- `POST /api/v1/sessions/<id>/heartbeat` with the `x-host-key` header and
  `{players, commit?, label?}`. See Live sessions below.
- `GET /api/v1/sessions/<id>/ice` returns fresh ICE servers, because TURN
  credentials last 60 seconds.
- `DELETE /api/v1/sessions/<id>` with the `x-host-key` header ends the session
  and deletes the channel. The host calls it when it leaves.

The client (`src/client/signaling.js`) opens `signalUrl`
(`wss://<host>/v2/<token>`) and sends
`{t:"u", m:{f, o:"message", t:<peer>}, p:<signal>}`
(`src/shared/signal-frame.js`). It names the sender from the frame's `f`, which
the channel sets. A token must be used before it expires, but an open socket
outlives it, so when a socket closes the client asks the shell for a new token.
`src/server/relay.ts` is the local relay: a WebSocket endpoint on the shell at
`/v2/<token>` that issues its own tokens and speaks the same frames. The shell
uses it when the Xirsys values are missing. Session starts and joins are limited
per IP in memory (120 a minute, so a room of phones on one Wi-Fi address fits;
ICE requests 240 a minute).

A signal for a peer that is not connected to its session channel is dropped. A
guest asks again when the host's `peer_connected` frame arrives, and otherwise
retries its join after eight seconds.

The Xirsys values belong in the server environment; the browser receives a short
lived signaling token and temporary ICE credentials. Without `XIRSYS_IDENT`,
`XIRSYS_SECRET`, and `XIRSYS_CHANNEL`, the server runs a local relay that speaks
the Xirsys frames, so `deno task start`, development, and e2e need no internet
(`SIGNALING=local` forces the relay even with credentials). To use real Xirsys,
put the values in an ignored `.env` file and run `deno task start:env`.
`tests/e2e/xirsys.spec.ts` connects a host and a guest through real Xirsys and
skips without the values in the environment.

## Live sessions

The host sends a heartbeat about every 15 seconds with its player count and
build. The `x-host-key` header proves the host, so only the host updates its
session. A session with no heartbeat for 45 seconds counts as ended, but its row
stays as history. A heartbeat on a session the host ended answers 410. Public
reads, with no host key and no peer id in them:

- `GET /api/v1/sessions` lists live sessions, newest first.
- `GET /api/v1/sessions/recent?limit=` lists ended sessions, newest first. A
  session whose heartbeat timed out has `ended` set to that time.
- `GET /api/v1/sessions/<id>/telemetry` lists the stored summaries of a session.

Each session is
`{id, build:{commit,label,path}, started, lastHeartbeat,
playerCount, ended}`.
`path` is `/b/<commit>/`, the build's base path.

A guest joins on the host's build. The join response carries the host's build,
and a client whose own commit differs opens `<path>join/<session>` (`local` is
the commit of the working tree). The world host still validates every guest
action; the build only decides which client the guest runs.

`POST /api/v1/telemetry` keeps its validation and its console line, and stores
each `summary` for 30 days. `connection` and `error` events stay in the log.

`src/server/sweep.ts` deletes the Xirsys channel of every ended session. Deno
Deploy has no cron here, so each session start and heartbeat runs the sweep, at
most once a minute in each isolate. An isolate takes a lease on a session in
Turso before it deletes the channel, so isolates running at once delete a
channel once. A failed delete is tried again after the two minute lease. The
same run prunes telemetry older than 30 days once an hour. A host that loses its
heartbeat for 45 seconds, for example in a tab the browser throttles, can lose
its channel to the sweep.

See the [live-session vision](../live-session-vision.md) and the
[multiplayer protocol design](../multiplayer-protocol-design.md).
