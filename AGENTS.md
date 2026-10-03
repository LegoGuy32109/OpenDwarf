# Open Dwarf

Read `README.md` and `docs/architecture.md` before changing the client or
network code. This branch is the client first Deno demo. The detached
`webgl-version` worktree may be used for comparison, but the Rust engine stays
on that branch.

Keep browser code in plain JavaScript with JSDoc types. Keep server code in
Deno TypeScript. Serve browser files without a build step. Use custom CSS and
keep runtime dependencies small.

Run `deno task verify` before pushing. The local pre-push hook can be installed
with `deno task hooks`. `deno task e2e` is optional and takes about two
minutes. Run it only when asked, or when a change to rendering, controls, or
networking needs a browser check.
