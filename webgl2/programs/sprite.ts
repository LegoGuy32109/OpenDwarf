/// <reference lib="dom" />

import { TEXTURE_UNITS } from "../texture-units.ts";
import { GLOBALS_UNIFORMS } from "./_chunks.ts";

export const SPRITE_STRIDE_FLOATS = 12;

export const attribs = {
  pos: 0,
  corner: 1,
  size: 2,
  uv: 3,
  tint: 4,
  alpha: 5,
} as const;

export const sampler = TEXTURE_UNITS.sprite;

export const vert = /* glsl */ `#version 300 es
precision highp float;
precision highp int;

layout(location = ${attribs.pos}) in vec2 a_pos;
layout(location = ${attribs.corner}) in vec2 a_corner;
layout(location = ${attribs.size}) in vec2 a_size;
layout(location = ${attribs.uv}) in vec4 a_uv_rect;
layout(location = ${attribs.tint}) in vec3 a_tint;
layout(location = ${attribs.alpha}) in float a_alpha;

uniform vec2 ${GLOBALS_UNIFORMS.camera};
uniform float ${GLOBALS_UNIFORMS.zoom};
uniform vec2 ${GLOBALS_UNIFORMS.canvasSize};
uniform float ${GLOBALS_UNIFORMS.simTick};

out vec2 v_uv;
out vec3 v_tint;
out float v_alpha;

void main() {
  vec2 world_px = a_pos + a_corner * a_size;
  vec2 screen_px = (world_px - ${GLOBALS_UNIFORMS.camera}) * ${GLOBALS_UNIFORMS.zoom} + ${GLOBALS_UNIFORMS.canvasSize} * 0.5;
  vec2 ndc = (screen_px / ${GLOBALS_UNIFORMS.canvasSize}) * 2.0 - 1.0;
  gl_Position = vec4(ndc * vec2(1.0, -1.0), 0.0, 1.0);
  v_uv = a_uv_rect.xy + a_corner * a_uv_rect.zw;
  v_tint = a_tint;
  v_alpha = a_alpha;
}
`;

export const frag = /* glsl */ `#version 300 es
precision highp float;
precision highp int;

uniform sampler2D u_texture;
in vec2 v_uv;
in vec3 v_tint;
in float v_alpha;
out vec4 out_color;

void main() {
  vec4 texel = texture(u_texture, v_uv);
  out_color = vec4(texel.rgb * v_tint, texel.a * v_alpha);
}
`;
