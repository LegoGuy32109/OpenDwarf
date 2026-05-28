import "$std/dotenv/load.ts";

import { start } from "fresh";
import manifest from "./fresh.gen.ts";
import config from "./fresh.config.ts";

await start(manifest, config);
