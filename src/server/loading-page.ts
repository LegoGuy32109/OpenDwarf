// Send the installed shell's terminal before any promotion, GitHub, or CDN wait.
// The selected commit still owns its complete game page, including older builds.
let template: Promise<string> | undefined;

export async function loadingPage(): Promise<Response> {
  template ??= Deno.readTextFile(
    new URL("../../public/index.html", import.meta.url),
  );
  const source = await template;
  const html = source
    .replace('<html lang="en">', '<html lang="en" data-shell="true">')
    .replace(/<!-- game-assets:start -->[\s\S]*?<!-- game-assets:end -->/, "")
    // Icons belong to the selected commit. The early shell has no remote base.
    .replace(/<link\s[^>]*>/g, "");
  return new Response(html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-cache",
      "x-content-type-options": "nosniff",
    },
  });
}
