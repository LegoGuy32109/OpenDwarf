/// <reference lib="dom" />

import { TEXTURE_UNITS } from "../texture-units.ts";
import { GLOBALS_UNIFORMS } from "./_chunks.ts";

export const EDGE_SHADOW_STRIDE_FLOATS = 5;

export const attribs = {
  pos: 0,
  corner: 1,
  size: 2,
  alpha: 3,
} as const;

export const sampler = TEXTURE_UNITS.edgeShadow;

export const vert = /* glsl */ `#version 300 es
precision highp float;
precision highp int;

layout(location = ${attribs.pos}) in vec2 a_pos;
layout(location = ${attribs.corner}) in vec2 a_corner;
layout(location = ${attribs.size}) in vec2 a_size;
layout(location = ${attribs.alpha}) in float a_alpha;

uniform vec2 ${GLOBALS_UNIFORMS.camera};
uniform float ${GLOBALS_UNIFORMS.zoom};
uniform vec2 ${GLOBALS_UNIFORMS.canvasSize};
uniform float ${GLOBALS_UNIFORMS.simTick};

out float v_alpha;

void main() {
  vec2 world_px = a_pos + a_corner * a_size;
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
  out_color = vec4(0.0, 0.0, 0.0, v_alpha);
}
`;
