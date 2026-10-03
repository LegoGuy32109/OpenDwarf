// The admin dashboard's files. The shell serves them from its own folder, not from a build, so
// the page works when every build is broken. Terms follow CONTEXT.md: Admin dashboard.
const FOLDER = new URL("./admin/", import.meta.url);

const FILES: Record<string, { file: string; type: string }> = {
  "/admin": { file: "index.html", type: "text/html; charset=utf-8" },
  "/admin/": { file: "index.html", type: "text/html; charset=utf-8" },
  "/admin/admin.js": {
    file: "admin.js",
    type: "text/javascript; charset=utf-8",
  },
  "/admin/admin.css": { file: "admin.css", type: "text/css; charset=utf-8" },
};

/** Answers a GET for the dashboard's page or one of its files; null for any other path. */
export async function serveAdminPage(path: string): Promise<Response | null> {
  const entry = Object.hasOwn(FILES, path) ? FILES[path] : null;
  if (!entry) return null;
  try {
    return new Response(await Deno.readFile(new URL(entry.file, FOLDER)), {
      headers: {
        "content-type": entry.type,
        "cache-control": "no-cache",
        "x-content-type-options": "nosniff",
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
