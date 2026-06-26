import { FLOOR_FRAMES } from "../../lib/webgl-chunk-gen.ts";

export const GLOBALS_UNIFORMS = {
  camera: "u_camera",
  zoom: "u_zoom",
  canvasSize: "u_canvas_size",
  simTick: "u_sim_tick",
} as const;

export const FLOOR_FRAME_COUNT = FLOOR_FRAMES;

// If per-frame global data grows beyond a handful of floats or program count
// exceeds about ten, migrate these globals to a UBO.
