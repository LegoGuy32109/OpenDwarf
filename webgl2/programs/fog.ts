/// <reference lib="dom" />

import { TEXTURE_UNITS } from "../texture-units.ts";
import { GLOBALS_UNIFORMS } from "./_chunks.ts";

export const FOG_STRIDE_FLOATS = 3;

export const attribs = {
  pos: 0,
  corner: 1,
  alpha: 2,
} as const;

export const sampler = TEXTURE_UNITS.white;

export const vert = /* glsl */ `#version 300 es
precision highp float;
precision highp int;

layout(location = ${attribs.pos}) in vec2 a_pos;
layout(location = ${attribs.corner}) in vec2 a_corner;
layout(location = ${attribs.alpha}) in float a_alpha;

uniform vec2 ${GLOBALS_UNIFORMS.camera};
uniform float ${GLOBALS_UNIFORMS.zoom};
uniform vec2 ${GLOBALS_UNIFORMS.canvasSize};
uniform float ${GLOBALS_UNIFORMS.simTick};

out float v_alpha;

const float TILE_PX = 64.0;

void main() {
  vec2 world_px = a_pos + a_corner * vec2(TILE_PX, TILE_PX);
  vec2 screen_px = (world_px - ${GLOBALS_UNIFORMS.camera}) * ${GLOBALS_UNIFORMS.zoom} + ${GLOBALS_UNIFORMS.canvasSize} * 0.5;
  vec2 ndc = (screen_px / ${GLOBALS_UNIFORMS.canvasSize}) * 2.0 - 1.0;
  gl_Position = vec4(ndc * vec2(1.0, -1.0), 0.0, 1.0);
  v_alpha = a_alpha;
}
`;

export const frag = /* glsl */ `#version 300 es
precision highp float;
precision highp int;

uniform sampler2D u_texture;
in float v_alpha;
out vec4 out_color;

void main() {
  vec4 texel = texture(u_texture, vec2(0.5, 0.5));
  out_color = vec4(1.0, 0.78, 0.18, texel.a * v_alpha);
}
`;
