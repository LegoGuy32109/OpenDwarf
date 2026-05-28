#version 300 es
precision highp float;
precision highp int;
in vec2 a_position;
in vec2 a_uv;
in vec2 a_instance_offset;
in vec2 a_instance_size;
in vec4 a_instance_uv;
uniform vec2 u_canvas_size;
uniform vec2 u_camera;
uniform float u_zoom;
uniform int u_render_mode;
out vec2 v_uv;
out float v_instance_alpha;

void main() {
  vec2 world_px = a_instance_offset + a_position * a_instance_size;
  vec2 screen_px = u_render_mode == 3
    ? world_px
    : (world_px - u_camera) * u_zoom + u_canvas_size * 0.5;
  vec2 ndc = (screen_px / u_canvas_size) * 2.0 - 1.0;
  gl_Position = vec4(ndc * vec2(1.0, -1.0), 0.0, 1.0);
  v_uv = a_uv * a_instance_uv.zw + a_instance_uv.xy;
  v_instance_alpha = a_instance_uv.x;
}
