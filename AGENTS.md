# Open Dwarf

Read `README.md` and `docs/architecture.md` before changing the client or
network code. This branch is the client first Deno demo. The detached
`webgl-version` worktree may be used for comparison, but the Rust engine stays
on that branch.

Keep browser code in plain JavaScript with JSDoc types. Keep server code in Deno
TypeScript. Serve browser files without a build step. Use custom CSS and keep
runtime dependencies small.

Run `deno task verify` before pushing. The local pre-push hook can be installed
with `deno task hooks`. `deno task e2e` is optional and takes about two minutes.
Run it only when asked, or when a change to rendering, controls, or networking
needs a browser check. When several worktrees run e2e at once, set a distinct
`PORT` for each, such as `PORT=8112 deno task e2e`, because Playwright reuses
any server already on its port.

## Evidence

A ticket with a visible change needs screenshots, and an interaction needs a
short video. In an e2e spec, call `evidenceShot(page, "<name>")` from
`tests/e2e/evidence.ts`. Run the spec with `EVIDENCE=1 deno task e2e <spec>`.
Screenshots go to `exports/evidence/`, and Playwright records each test's
`video.webm` under `exports/playwright-results/`. Publish them with:

```sh
deno task evidence:publish <issue>-<slug> exports/evidence/<name>.png \
  exports/playwright-results/<test>/video.webm=<name>.webm
```

The script commits the files to the orphan `evidence` branch, adds a GIF preview
for each video, and prints Markdown to paste into the issue and pull request.
