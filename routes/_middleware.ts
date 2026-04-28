import { type FreshContext } from "$fresh/server.ts";

export async function handler(_req: Request, ctx: FreshContext) {
  const response = await ctx.next();

  response.headers.set("Cross-Origin-Opener-Policy", "same-origin");
  response.headers.set("Cross-Origin-Embedder-Policy", "require-corp");
  response.headers.set("Cross-Origin-Resource-Policy", "same-origin");
  response.headers.set("Origin-Agent-Cluster", "?1");

  return response;
}
