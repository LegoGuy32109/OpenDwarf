import { Handler } from "$fresh/server.ts";

export const handler = {
  GET(_: Request, _ctx: Handler) {
    const file = Deno.readFileSync("./static/game/opt_open_dwarf_lib.wasm.br");
    return new Response(file, {
      headers: {
        "Content-Type": "application/wasm",
        "Content-Encoding": "br",
        "Vary": "Accept-Encoding",
      },
    });
  },
};
