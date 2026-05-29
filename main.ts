import "$std/dotenv/load.ts";

import { App, cors, staticFiles } from "fresh";

export const app = new App()
  .use(cors({ origin: "*" }))
  .use(staticFiles())
  .fsRoutes();
