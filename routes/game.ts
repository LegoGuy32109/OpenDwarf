import { type HandlerContext } from "fresh";
import { Handlers } from "fresh/compat";

// indicate that when fetching /game you're serving a
// br compressed wasm file
export const handler: Handlers = {
  GET(_ctx: HandlerContext) {
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
