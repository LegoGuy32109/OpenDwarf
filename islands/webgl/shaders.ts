export const TILE_VERTEX_SHADER = `#version 300 es
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
`;

export const TILE_FRAGMENT_SHADER = `#version 300 es
  precision highp float;
  precision highp int;
  uniform sampler2D u_texture;
  uniform vec3 u_tint;
  uniform float u_alpha_multiplier;
  uniform int u_render_mode;
  in vec2 v_uv;
  in float v_instance_alpha;
  out vec4 out_color;

  void main() {
    vec4 texel = texture(u_texture, v_uv);
    if (u_render_mode == 1) {
      out_color = vec4(0.0, 0.0, 0.0, texel.a * u_alpha_multiplier);
    } else if (u_render_mode == 2) {
      out_color = vec4(0.0, 0.0, 0.0, v_instance_alpha);
    } else if (u_render_mode == 3) {
      out_color = vec4(u_tint, texel.a * u_alpha_multiplier);
    } else if (u_render_mode == 5) {
      out_color = vec4(u_tint, u_alpha_multiplier);
    } else {
      out_color = texel;
      out_color.rgb *= u_tint;
    }
  }
`;
