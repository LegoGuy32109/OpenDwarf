# Admin dashboard

`/admin` is the admin dashboard: a public, read-only page the shell serves from
`src/server/admin/` (plain HTML, CSS, and JavaScript), not from a build, so it
works when every build is broken. `src/server/admin-page.ts` serves its three
files. The page only reads `/api/v1/status`, `/promotions`, `/shell-deploys`,
`/sessions/recent`, and `/sessions/<id>/telemetry`, holds no credential, and has
no write control. It refreshes every 15 s. A live session's join link is
`/b/<commit>/join/<session>`. The e2e spec starts `tests/e2e/seed-shell.ts`, a
shell with seeded history, to capture it.
