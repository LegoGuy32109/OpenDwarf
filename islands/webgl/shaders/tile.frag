#version 300 es
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
