/// <reference lib="deno.unstable" />
import { createApp } from "./src/server/app.ts";

const kv = await Deno.openKv();
const port = Number(Deno.env.get("PORT") ?? 8000);
Deno.serve({ port }, createApp(kv));
