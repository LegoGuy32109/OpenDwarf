import { type FreshContext } from "$fresh/server.ts";

function isPerfRequest(url: URL): boolean {
  return url.searchParams.has("perf") || url.pathname.startsWith("/game_perf");
}

export async function handler(_req: Request, ctx: FreshContext) {
  const response = await ctx.next();

  if (isPerfRequest(ctx.url)) {
    response.headers.set("Cross-Origin-Opener-Policy", "same-origin");
    response.headers.set("Cross-Origin-Embedder-Policy", "require-corp");
    response.headers.set("Cross-Origin-Resource-Policy", "same-origin");
    response.headers.set("Origin-Agent-Cluster", "?1");
  }

  return response;
}
