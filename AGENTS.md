# Open Dwarf

Read `README.md` and `docs/architecture.md` before changing the client or
network code, then the `docs/features/` file for your area. A ticket documents
its feature in its own `docs/features/` file (and adds one line to the README
index for a new file); it does not extend `README.md` or `docs/architecture.md`.
This branch is the client first Deno demo. The detached `webgl-version` worktree
may be used for comparison, but the Rust engine stays on that branch.

Keep browser code in plain JavaScript with JSDoc types. Keep server code in Deno
TypeScript. Serve browser files without a build step. Use custom CSS and keep
runtime dependencies small.

Run `deno task verify` before pushing. The local pre-push hook can be installed
with `deno task hooks`. `deno task e2e` is optional and takes about two minutes.
Run it only when asked, or when a change to rendering, controls, or networking
needs a browser check. When several worktrees run e2e at once, set a distinct
`PORT` for each, such as `PORT=8112 deno task e2e`, because Playwright reuses
any server already on its port.

## Deploy

Client changes never need a deploy. Deploy only when shell code changes, with
`deno task deploy` (try `--dry-run` first). It refuses on a dirty tree or a
pending `od-prod` migration, and it records a Shell deploy. Never deploy from a
worker without being asked.

A pushed branch is a preview: `https://od.joshhale.me/b/<branch>` (no slashes in
the branch name). Production `/` serves main, which changes only with
`deno task od promote <label|branch|sha> --prod`.

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

## Orchestration

Tickets run as Orca workers. Workers read `docs/worker-primer.md`; the brief
they get is `docs/orca/worker-brief.md`. The coordinator uses:

```sh
export ORCA_RUN=<run id>
deno task orca start --issue <n> --slug <slug> --title "<title>" [--base <branch>] [--notes notes.md]
deno task orca wait     # one waiter per run; returns only worker reports
deno task orca merge --pr <n> [--comment "..."] [--map <n> --decision "- [Title](url) — gist"]
```

`merge` squash-merges, deletes the branch, releases the worker, removes its
worktree, pulls, and adds the decision to the map.

Write contracts before starting parallel workers. When several tickets share a
module or an API, the coordinator first commits the interface (types, route
shapes, empty test files), so the tickets can run at the same time instead of
waiting on each other. Keep a ticket to one session; split anything larger.
