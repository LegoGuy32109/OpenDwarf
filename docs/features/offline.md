# Offline play

After one visit, a page loads with no network and starts a single-player world
([ADR 0007](../adr/0007-media-from-r2-and-offline-play.md)). A **service
worker** per build does the caching. The shell serves only a one-line loader
(`/sw.js`, `/b/<name>/sw.js`); the worker's code is `public/js/sw-main.js`, so a
caching change is a push.

## Registration

`registerWorker` in `src/client/offline.js` registers `<build base>sw.js` with
scope `<build base>` (`build.base`). `startApp` calls it last, after the frame
loop starts, so it never delays the first frame. `?sw=0` skips it. A failed
registration is ignored: the game runs without a worker.

## What the worker caches

| Request                                                                                      | Rule                                                                                                                                               |
| -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Build files: a jsDelivr URL with a commit, or the local origin's `/js/ /src/ /assets/ /css/` | Cache first in `od-build-<commit>`. The local build is `od-build-local` and goes network first, so dev edits show.                                 |
| Pages (navigations)                                                                          | Network first, 3 s timeout, then the last copy of that URL (`od-pages`).                                                                           |
| Media `/media/...?v=<hash>`                                                                  | Cache first in `od-media`, filled on a miss. A `Range` request from a cached file gets `206` with `Content-Range`, as Safari's audio player needs. |
| `/api/` and anything else                                                                    | Network only. Never cached.                                                                                                                        |

The worker keeps the newest three `od-build-*` caches; it records the commits it
has seen in `od-build-index`. `od-media` is the music player's cache, keyed by
the full media URL, and the worker reads the same entries. The worker calls
`skipWaiting` and `clients.claim`, so a new build's worker takes over on the
next load.

The rules that need no worker (cache names, which caches to keep, the range
answer) hang on `globalThis.odSw` in `sw-main.js`, and
`tests/client/sw_rules_test.ts` runs them.

## Offline single player

`isOffline()` is `navigator.onLine === false`. That is also true on a network
with no route out, so the first call to the shell, the QR code request in
`startHosting`, decides too: a request that cannot be made (a `TypeError`) sets
`ui.offline`. While offline:

- The join link is off. The menu's top bar shows `OFFLINE` where the QR button
  is, and the menu's build line ends with `OFFLINE`.
- The QR code is not loaded, and the update check does not start.
- Session start, heartbeats, and telemetry fail without a message. Signaling
  keeps retrying and says nothing for a request that never reached the shell.

The world host is the same code and validates the same actions. When the network
comes back, reload: the page starts a session, the join tools, and the update
check as usual.

## Tests

`tests/e2e/offline.spec.ts` loads the page, waits for the worker to control it,
goes offline with `context.setOffline(true)`, reloads, and checks that the game
draws, the player moves, and a `Range` request for a fixture track answers `206`
from the cache. Every other spec runs with `serviceWorkers: "block"`
(`playwright.config.ts`), because a worker answers its page's requests where
`page.route` cannot see them.
