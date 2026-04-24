import { type HandlerContext, type Handlers } from "$fresh/server.ts";

export const handler: Handlers = {
  GET(_req: Request, _ctx: HandlerContext) {
    const file = Deno.readFileSync(
      "./static/game_perf/opt_open_dwarf_lib.wasm.br",
    );
    return new Response(file, {
      headers: {
        "Content-Type": "application/wasm",
        "Content-Encoding": "br",
        "Vary": "Accept-Encoding",
      },
    });
  },
};
