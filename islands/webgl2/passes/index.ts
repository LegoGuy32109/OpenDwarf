import type { Pass } from "../gpu-types.ts";
import type { FrameContext } from "../frame-context.ts";
import { FloorPass } from "./floor.ts";

export const ALL_PASSES: Pass<FrameContext>[] = [FloorPass];
