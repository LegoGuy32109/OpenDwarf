import { createApp } from "./src/server/app.ts";

const port = Number(Deno.env.get("PORT") ?? 8000);
Deno.serve({ port }, createApp());
