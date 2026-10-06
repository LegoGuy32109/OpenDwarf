const root = new URL("./", import.meta.url);
const types: Record<string, string> = {
  html: "text/html",
  js: "text/javascript",
  css: "text/css",
  md: "text/plain",
};
Deno.serve({ hostname: "0.0.0.0", port: 8067 }, async (request) => {
  const path = new URL(request.url).pathname;
  const name = path === "/" ? "index.html" : path.slice(1);
  if (
    !["index.html", "style.css", "app.js", "voice.js", "library.js"].includes(
      name,
    )
  ) {
    return new Response("Not found", { status: 404 });
  }
  try {
    return new Response(await Deno.readFile(new URL(name, root)), {
      headers: {
        "content-type": types[name.split(".").at(-1)!] + "; charset=utf-8",
        "cache-control": "no-store",
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
});
