# Media and offline

Large assets (music now, art later) live in the Cloudflare R2 bucket
`opendwarf`, not in git. The shell hands out links to them and loads each
build's service worker. Everything else is in the bucket or the client, so new
content never needs a shell deploy. The design is in
[ADR 0007](../adr/0007-media-from-r2-and-offline-play.md).

## Routes

- `GET|HEAD /media/<key>` with `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`,
  `R2_ENDPOINT` and `R2_BUCKET` all set: a `302` to a SigV4 presigned `GET` URL
  for the key (`src/server/r2.ts`), valid for 3600 s, with
  `Cache-Control: public, max-age=300`. The URL is path style
  (`<R2_ENDPOINT>/<R2_BUCKET>/<key>`), region `auto`, service `s3`, payload
  `UNSIGNED-PAYLOAD`, and `host` is the only signed header. The query string of
  the request (such as `?v=<hash>`) is not part of the key. The shell does not
  check that the object exists; a missing key is the bucket's own `404`. The
  shell never logs a key or a signed URL.
- Without all four variables: the same path serves the file from `OD_MEDIA_DIR`
  (default `media/`) with `Range` support, so dev and e2e need no bucket.
- A key is 1 to 512 characters of path segments made of letters, digits, space
  and `._()~-`; no segment starts with `.`. Anything else is a `404`.
- `GET /sw.js` (main) and `GET /b/<name>/sw.js` (any build): the service worker
  loader, `text/javascript` with `Cache-Control: no-cache`. The body is
  `importScripts("<jsDelivr base of the commit>js/sw-main.js"); // build <sha>`,
  so a new commit installs a new worker. An unknown build, or main before the
  first promotion, is a `404`. The local build (`OD_LOCAL_BUILD=1`) imports
  `/js/sw-main.js`.

## The `media/` folder

`media/` mirrors the bucket. `media/index/*.json` is tracked in git; everything
else in it is git-ignored. Indexes are named with their schema version, such as
`index/music.v1.json`.

## Add content without a deploy

1. Put the files in `media/` (`deno task media convert <folder>` turns mp3s into
   64 kbps Opus in `media/music/`).
2. Add or edit entries in `media/index/<name>.v1.json`, then run
   `deno task media hash` to fill the hashes.
3. Run `deno task media upload`. It sends changed files to the bucket (R2 keys
   in `.env`).

A breaking index change is a new file name (`music.v2.json`); old builds keep
reading v1.

## Shell variables

The four `R2_*` variables above are set in Deno Deploy. Without them the
production shell serves from its own (empty) `media/` folder, so `/media/...`
answers `404`. `deno task smoke` checks `/media/index/music.v1.json`: it follows
the redirect and expects `200` and JSON with a `tracks` array.
