# Shell and builds

The shell records live sessions and telemetry summaries in Turso (see
[sessions and signaling](sessions-and-signaling.md)).

## Build routes

`src/server/builds.ts` serves the build pages. `/b/<name>` resolves `<name>` as
a label, then a branch, then a commit SHA of 7 to 40 hex characters. A branch
becomes its latest commit through the GitHub API (`GITHUB_TOKEN` when set),
cached for 60 s; a commit never changes, so its lookups and its page stay cached
for a day. The shell fetches that commit's `public/index.html` from jsDelivr,
sets `<base href>` to the commit's `public/` folder on jsDelivr, and fills the
build config with base `/b/<name>/`, an empty `api` (the shell), the label, and
the commit. `/`, `/host`, and `/join/<session>` serve main, the latest
promotion, the same way with base `/`; before the first promotion they show a
short message. An unknown name gets a 404 page that links to `/admin`.

The shell serves no files from disk, except for the build `local` and the admin
dashboard. `deno task dev` sets `OD_LOCAL_BUILD=1`, so `/` and `/b/local` serve
the working tree, with `/js/`, `/css/`, `/assets/`, and `/src/` read from disk.
Playwright starts its server the same way, so e2e specs run the working tree.
`/b/<sha>` still loads from jsDelivr under `dev`, which needs a pushed commit.

## Build base path

A build can be served under a path such as `/b/test/`, with its files on another
origin ([ADR 0004](../adr/0004-shell-serves-builds-from-commits.md)), so the
client assumes neither. `public/index.html` names its CSS and scripts with
relative paths. A `<base href>` in the page says where they live; the Deno
server serves them from `/`, and the shell sets it to the build's file origin.
The shell also fills `<script id="od-build" type="application/json">` with
`{"base", "api", "label", "commit"}`. `src/client/build.js` reads it: `base` is
the page's path prefix and `api` is the API origin. Without that script the base
is `/` and the API is the page's own origin.

Routes are read under the base: `<base>` starts a world host, `<base>host` lists
worlds to join, and `<base>join/<session>` joins one. A join link and its QR
code carry the base, so a guest opens the host's build. The client calls
`<api>/api/v1/...`; the Deno server answers the same routes at `/api/v1/` and at
their older `/api/` paths. `/api/v1/qr/<session>` encodes the `link` query
parameter when it ends in `/join/<session>`, and its own `/join/<session>`
otherwise. Browser code names no absolute `/css`, `/js`, `/src`, `/assets`, or
`/api` path except through this config. `tests/e2e/base-path.spec.ts` serves the
page at `/b/test/` with its files from a second local port.

## Shell database

The shell keeps labels, promotions, shell deploys, sessions, and telemetry
summaries in Turso (see ADR 0004). `migrations/` holds numbered SQL files.
`deno task db:migrate` applies the pending ones to the database named by
`TURSO_DB_URL` and `TURSO_DB_TOKEN` in `.env`, and `deno task db:migrate:prod`
reads `.env.prod`. Each applied file is recorded with its checksum in
`schema_migrations`, so a second run changes nothing and an edited migration is
refused. Add a schema change as a new numbered file.

`src/server/store.ts` is the one interface the shell uses. `createTursoStore`
talks to Turso, `createMemoryStore` serves unit tests, and `openStore()` picks
Turso when both variables are set and the memory store otherwise. Main is the
latest promotion. The shared cases in `tests/server/store_cases.ts` run against
both stores; the Turso run is skipped without credentials and needs a scratch
database, because the cases leave rows behind.

## Owner CLI

`deno task od <command>` manages labels and main on a shell through `/api/v1`.
It talks to `http://localhost:8000` by default, to another shell with
`--base-url`, and to `https://od.joshhale.me` with `--prod`.

```sh
deno task od label set <name> <branch|sha>   # a branch label follows the branch
deno task od label rename <old> <new>
deno task od label rm <name>
deno task od labels
deno task od promote <label|branch|sha> [--note "why"]   # saves the resolved commit
deno task od promotions
deno task od status                          # main, labels, live sessions
```

Every command has `--help`. Reads are public. Writes need `OD_OWNER_TOKEN`: set
the same value in the shell's environment (the shell keeps only its SHA-256
hash) and in `.env` for the CLI, or in `.env.prod` for `--prod`. A shell without
`OD_OWNER_TOKEN` answers every write with 403, and a wrong or missing token
gets 401.

## Deploy

Only the shell is deployed, and only when its own code changes. A client change
needs a push, not a deploy (see
[ADR 0004](../adr/0004-shell-serves-builds-from-commits.md)).

```sh
deno task deploy --dry-run   # checks the rules, prints the upload and the record
deno task deploy --note "why"
```

`deno task deploy` deploys the working tree to the `opendwarf` app in
`legoguy32109` as production, with `jsr:@deno/deploy` and `--prod`. It restores
the `deno.json` bytes the CLI rewrites. It refuses when the working tree is
dirty, or when `od-prod` has a pending migration (run
`deno task db:migrate:prod` first). After the CLI succeeds it records a Shell
deploy (commit, Deno revision from the CLI's `--json` output, time, note) in
`od-prod`. A failed deploy records nothing. It needs `DENO_DEPLOY_TOKEN` in the
environment and `TURSO_DB_URL` and `TURSO_DB_TOKEN` in `.env.prod`. Do not print
them.

The upload still includes `public/`, `src/client/`, and `src/shared/`, but
production serves builds from jsDelivr; those files are served from disk only
with `OD_LOCAL_BUILD=1`.

The `deploy` section in `deno.json` uses a dynamic Deno Deploy app with
`main.ts` as its entrypoint. Set `TURSO_DB_URL` and `TURSO_DB_TOKEN` so the
shell keeps sessions and telemetry, and `XIRSYS_IDENT`, `XIRSYS_SECRET`, and
`XIRSYS_CHANNEL` so WebRTC can use TURN when a direct connection is unavailable.

For CLI access to the existing `opendwarf` app, load `DENO_DEPLOY_TOKEN` from
`~/Projects/work-portal/.env` into the command environment. Do not copy the
token into this repository.

The GitHub repository is not linked to the `opendwarf` app, so a push deploys
nothing. A pushed commit is a build at `https://od.joshhale.me/b/<branch|sha>`,
and `/` serves main, which `deno task od promote ... --prod` changes. The app
answers on `od.joshhale.me`, `opendwarf.joshhale.me`, and `dwarf.joshhale.me`.
Add any extra domains in Deno Deploy and DNS manually; the code does not
register domains. The production variables are `TURSO_DB_URL`, `TURSO_DB_TOKEN`,
`OD_OWNER_TOKEN`, and the three `XIRSYS_*` values; `GITHUB_TOKEN` is optional
and raises the GitHub API limit for branch lookups.

See the Deno Deploy
[build configuration](https://docs.deno.com/deploy/reference/builds/).
