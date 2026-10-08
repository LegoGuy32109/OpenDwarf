---
status: accepted
---

# Media from R2 and offline play

Music is 191 MB and will grow, with art and other assets to follow. Git and
jsDelivr are the wrong home for it, and a shell deploy for each new track is too
slow. Players should keep what they download, and the game should eventually run
with no network at all.

## Decisions

Settled with Josh on 2026-10-07.

**One shell deploy, then content only.** The shell knows nothing about what
media means. It hands out links to bucket objects and loads the build's service
worker. Everything else (index formats, tags, new kinds of assets, caching
rules) lives in the bucket or in the client, so it changes without a deploy.

**Bucket.** Cloudflare R2 bucket `opendwarf`. A **media key** is an object's
path in the bucket, such as `music/ACelticTale.ogg` or `index/music.v1.json`.
The repo's `media/` folder mirrors the bucket: `media/index/*.json` is tracked
in git, and everything else in `media/` is git-ignored. `deno task media upload`
sends changed files. The bucket allows `GET` and `HEAD` from the three
production origins and `localhost:8000` (CORS, set on 2026-10-07).

**Shell routes.** These are the shell's whole media contract.

- `GET|HEAD /media/<key>` with R2 configured (`R2_ACCESS_KEY_ID`,
  `R2_SECRET_ACCESS_KEY`, `R2_ENDPOINT`, `R2_BUCKET`): a `302` to a SigV4
  presigned `GET` URL for that key, valid for 3600 s, with
  `Cache-Control: public, max-age=300`. The query string (such as `?v=`) is not
  part of the key and is ignored. The shell does not check that the object
  exists; a missing key is the bucket's own `404`.
- Without R2: the same path serves the file from `OD_MEDIA_DIR` (default
  `media/`), with `Range` support, so dev and e2e need no bucket.
- A key is 1 to 512 characters of path segments made of letters, digits, space
  and `._()~-`; no segment starts with `.`. Anything else is a `404`.
- `GET /sw.js` and `GET /b/<name>/sw.js`: the service worker loader for that
  build, `Cache-Control: no-cache`, `text/javascript`. Its body is one line,
  `importScripts("<build files base>js/sw-main.js");`, with the commit in a
  comment so a promotion or a new commit makes the browser install a new worker.
  The local build imports `/js/sw-main.js`.

**Media index.** An index is a JSON file under `index/` with its schema version
in the name: `index/music.v1.json`. More tracks or tags means uploading a new
copy of the same file. A breaking change means a new name (`music.v2.json`); old
builds keep reading v1, so both versions live in the bucket until no build reads
v1. The client always fetches an index fresh (`cache: "no-cache"`).

Music v1:

```json
{
  "version": 1,
  "tracks": [
    {
      "key": "music/ACelticTale.ogg",
      "hash": "1f2e3d4c5b6a",
      "duration": 214,
      "tags": ["adventure", "forest", "celebration"],
      "note": "optional free text"
    }
  ]
}
```

`hash` is the first 12 hex digits of the file's MD5. `deno task media hash`
fills it in.

**Media URLs.** The client asks for `build.mediaUrl(key, hash)`, which is
`<shell origin>/media/<key>?v=<hash>`. A changed file has a new hash, so a new
URL, so no cache ever serves a stale copy. Music is 64 kbps Opus in `.ogg`.

**Device cache.** Downloaded media goes in the Cache Storage cache `od-media`,
keyed by the full media URL. The music player reads and writes it directly
today; the service worker reads the same cache later, so nothing downloads
twice. The player keeps at most 150 MB of music and evicts the least recently
played track first. It asks for `navigator.storage.persist()`.

**Service worker.** The shell serves only the loader; the worker's code is
`public/js/sw-main.js` in each build, so caching changes are a push. A build
registers `<build path>sw.js` with scope `<build path>`.

- Build files: jsDelivr URLs for a commit never change, so they are cache-first
  in `od-build-<commit>`. The worker keeps the newest three build caches.
- Pages: network-first with a short timeout, falling back to the last copy.
- Media: `od-media` cache-first, answering `Range` requests from the cached file
  with `206`, as Safari's audio player requires.
- API calls are never cached. Offline, the game still starts a single-player
  world host; hosting for others, joining, sessions and telemetry turn off
  cleanly and come back when the network does.

## Consequences

- Anyone who knows a media key can download it, the same as the build files.
- New keys, a new bucket, or changes to signing or the loader need a shell
  deploy. Nothing else in this ADR does.
- Safari may clear a website's storage after about 7 days without a visit; a
  Home Screen app keeps it. After a clear, media downloads again as it plays.
