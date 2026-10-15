# Startup terminal

The game shows an HTML terminal while it loads. The terminal uses the same 8x16
bitmap atlas as the WebGL interface, embedded as a data URL in
`public/index.html`. CSS masks color the glyphs. It needs no font request,
external stylesheet, or WebGL context to paint. Each line retains real text for
screen readers. Without JavaScript, the initial text and a requirement message
remain visible.

The screen has a title, completed steps marked `[ok]`, and a current line marked
`>`. It has no progress bar or estimated percentage. The renderer reports the
actual count of eight required textures. Optional music and sound effects do not
hold the screen open.

## Delivery and stages

For remote builds, `src/server/loading-page.ts` returns the installed shell's
terminal before promotion, GitHub, or CDN work. It omits game stylesheet,
module, and icon requests until the selected build is known. An inline request
for the same route with `__od_page=1` gets the selected commit's full page.
`document.open/write/close` installs that page, preserving its scripts, base,
and configuration, including historical builds. The visible URL and host/join
path stay unchanged. The early shell's slow timer is canceled before handoff.
The selected page owns loading feedback after handoff. Older builds retain their
original startup behavior.

Local development serves `public/index.html` directly. Its terminal starts at
code loading. Remote delivery starts at build lookup and then hands over to that
same code-loading stage for current builds.

The actual client order is:

1. Dynamically import the application and its module graph.
2. Create the context and local world.
3. Create WebGL and load the font and world textures.
4. Draw the first world frame.

`src/client/startup.js` connects those stages to the inline terminal.
`createRenderer` accepts an optional asset callback. Its `render` result says
whether it drew the world with its textures. `startLoop` calls its one-time
startup callback after that draw. Only then does it set `canvas.dataset.ready`,
mark the page booted, record `od-first-world-frame`, and hide the terminal.
Guest connection and snapshot status continue through the existing game UI.

## Slow loads and failures

After 15 seconds, a pending stage says it is taking longer and offers retry. A
slow request keeps running. A module, asset, WebGL, or build request failure
shows a failure line, diagnostic details, and retry. Retry reloads the original
route. A late completion cannot dismiss a failed startup screen.

The shell must be running before it can return the terminal. Platform startup or
connection delays before any response still cannot display custom HTML. The
server change removes build-resolution work from the initial HTML wait. It does
not establish the cause of the previously measured 16-second response.

The worker caches the terminal's selected-document request as a page, alongside
navigations, so remote offline startup can reuse both documents. The local build
keeps its existing single-document offline path.

## Verification and evidence

`tests/server/builds_test.ts` proves the early response does not call the
promotion store or CDN and omits external game dependencies.
`tests/e2e/startup.spec.ts` holds a required texture, checks desktop and phone
terminal states, verifies first-frame completion, retries a failed texture, and
holds remote build lookup before testing the original document's handoff.
`boot-error.spec.ts` covers module failures and slow loads. Changed specs run
with `--repeat-each=5`. Base-path and offline specs cover existing startup
paths.

With `EVIDENCE=1`, the startup spec saves `startup-terminal-desktop`,
`startup-terminal-phone`, `startup-build-wait`, and `startup-texture-error`
screenshots plus Playwright videos. Evidence stays local until publication is
requested.
