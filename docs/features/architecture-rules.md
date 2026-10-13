# Architecture rules

Many agents edit this repo at once, and a few hub files take most of the edits
and most of the merge conflicts. The rules below keep new game behavior from
growing them. [Fallow](https://fallow.tools) checks the rules from the module
graph.

## The zones

`.fallowrc.json` names four zones under `boundaries`:

| Zone             | Files                                                                                                                                                    | May import              |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| `shared`         | `src/shared/`                                                                                                                                            | itself                  |
| `client-hub`     | `app`, `network`, `render`, `ui`, `ui-draw`, `context`, `session`, `loop`, `harness`, `input`, `input-read`, `panels` in `src/client/`, and `public/js/` | shared, client features |
| `client-feature` | the rest of `src/client/`                                                                                                                                | shared, other features  |
| `server`         | `src/server/`, `main.ts`                                                                                                                                 | shared                  |

A feature module never imports a hub. A new feature is a new module plus one
registration line in a hub, so two features do not edit the same hub file.

## Run it

```sh
deno task arch
```

The task runs `fallow architecture` against `fallow-baseline.json`, which lists
the violations that exist today (a feature reaching into `context.js`, `ui.js`,
`render.js`, `input-read.js` or `panels.js`). Only a new violation fails, and
nothing in the merge gate runs it. The `architecture` job in
`.github/workflows/e2e.yml` runs it nightly and on a PR with the `e2e` label.

## Paying the baseline down

Each baseline entry is a feature that reads shared state or a service through a
hub, usually `context.js`. When a change removes one, regenerate the baseline:

```sh
npx fallow@3.33.1 architecture --save-baseline fallow-baseline.json
```

and commit the smaller file. Do not add a violation to the baseline to make the
check pass; restructure the import instead.
