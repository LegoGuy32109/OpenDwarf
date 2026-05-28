#!/usr/bin/env -S deno run -A --watch=static/,routes/

import { Builder } from "fresh/dev";

import "$std/dotenv/load.ts";

const builder = new Builder({ root: Deno.cwd() });

builder.onTransformStaticFile(
  { pluginName: "shader-text-loader", filter: /\.(vert|frag)$/ },
  ({ text }) => ({ content: `export default ${JSON.stringify(text)};` }),
);

if (Deno.args.includes("build")) {
  await builder.build();
} else {
  await builder.listen(() => import("./main.ts"));
}
