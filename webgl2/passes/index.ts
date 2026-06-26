import type { Pass } from "../gpu-types.ts";
import type { FrameContext } from "../frame-context.ts";
import { FloorPass } from "./floor.ts";
import { EdgeShadowPass } from "./edge-shadow.ts";
import { CeilShadowPass } from "./ceil-shadow.ts";
import { FogPass } from "./fog.ts";
import { PlayerPass } from "./player.ts";
import { ChatPass } from "./chat.ts";
import { HudPass } from "./hud.ts";

export const ALL_PASSES: Pass<FrameContext>[] = [
  FloorPass,
  EdgeShadowPass,
  CeilShadowPass,
  FogPass,
  PlayerPass,
  ChatPass,
  HudPass,
];
