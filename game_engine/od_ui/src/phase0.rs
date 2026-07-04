use od_core::{DrawCmd, GlyphInstance, ProgramId, RectInstance};

const VGA_FIRST_CHAR: u32 = 33;
const VGA_LAST_CHAR: u32 = 126;
const VGA_COLUMNS: u32 = 32;
const VGA_CELL_WIDTH: f32 = 8.0;
const VGA_CELL_HEIGHT: f32 = 16.0;

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub struct Phase0FrameCounts {
  pub rects: usize,
  pub glyphs: usize,
  pub draw_cmds: usize,
  pub dropped_rects: usize,
  pub dropped_glyphs: usize,
  pub dropped_draw_cmds: usize,
}

fn push_rect(
  rects: &mut [RectInstance],
  count: &mut usize,
  pos: [f32; 2],
  size: [f32; 2],
  tint: [f32; 3],
  alpha: f32,
) -> bool {
  if let Some(slot) = rects.get_mut(*count) {
    *slot = RectInstance {
      pos,
      size,
      tint,
      alpha,
    };
    *count += 1;
    true
  } else {
    false
  }
}

fn push_glyph(
  glyphs: &mut [GlyphInstance],
  count: &mut usize,
  pos: [f32; 2],
  size: [f32; 2],
  uv_rect: [f32; 4],
  tint: [f32; 3],
  alpha: f32,
) -> bool {
  if let Some(slot) = glyphs.get_mut(*count) {
    *slot = GlyphInstance {
      pos,
      size,
      uv_rect,
      tint,
      alpha,
    };
    *count += 1;
    true
  } else {
    false
  }
}

fn push_draw_cmd(
  draw_cmds: &mut [DrawCmd],
  count: &mut usize,
  program: ProgramId,
  instance_offset: usize,
  instance_count: usize,
) -> bool {
  if let Some(slot) = draw_cmds.get_mut(*count) {
    *slot = DrawCmd {
      program: program.as_u32(),
      instance_offset: instance_offset as u32,
      instance_count: instance_count as u32,
      scissor_x: 0,
      scissor_y: 0,
      scissor_w: -1,
      scissor_h: -1,
      reserved: 0,
    };
    *count += 1;
    true
  } else {
    false
  }
}

fn glyph_uv_rect(code: u32) -> [f32; 4] {
  let clamped = code.clamp(VGA_FIRST_CHAR, VGA_LAST_CHAR);
  let glyph_index = clamped - VGA_FIRST_CHAR;
  let cell_x = glyph_index % VGA_COLUMNS;
  let cell_y = glyph_index / VGA_COLUMNS;
  let atlas_width = VGA_COLUMNS as f32 * VGA_CELL_WIDTH;
  let atlas_height = 3.0 * VGA_CELL_HEIGHT;
  [
    (cell_x as f32 * VGA_CELL_WIDTH) / atlas_width,
    (cell_y as f32 * VGA_CELL_HEIGHT) / atlas_height,
    VGA_CELL_WIDTH / atlas_width,
    VGA_CELL_HEIGHT / atlas_height,
  ]
}

pub fn build_phase0_demo_frame(
  framebuffer_w: u32,
  framebuffer_h: u32,
  dpr: f32,
  rects: &mut [RectInstance],
  glyphs: &mut [GlyphInstance],
  draw_cmds: &mut [DrawCmd],
) -> Phase0FrameCounts {
  let mut rect_count = 0;
  let mut glyph_count = 0;
  let mut draw_count = 0;
  let mut dropped_rects = 0;
  let mut dropped_glyphs = 0;
  let mut dropped_draw_cmds = 0;

  let scale = dpr.max(1.0).round().max(1.0);
  let scale_x = scale;
  let scale_y = scale;
  let panel_w = (framebuffer_w as f32 * 0.44).clamp(240.0, 360.0);
  let panel_h = (framebuffer_h as f32 * 0.18).clamp(88.0, 132.0);
  let panel_x = 32.0 * scale_x.min(2.0);
  let panel_y = 32.0 * scale_y.min(2.0);
  let border = 2.0 * scale;
  let text = "hello";
  let text_x = panel_x + 16.0 * scale;
  let text_y = panel_y + 18.0 * scale;
  let text_size = [8.0 * scale, 16.0 * scale];

  if !push_rect(
    rects,
    &mut rect_count,
    [panel_x, panel_y],
    [panel_w, panel_h],
    [0.10, 0.12, 0.16],
    1.0,
  ) {
    dropped_rects += 1;
  }
  if !push_rect(
    rects,
    &mut rect_count,
    [panel_x, panel_y],
    [panel_w, border],
    [0.78, 0.62, 0.34],
    1.0,
  ) {
    dropped_rects += 1;
  }
  if !push_rect(
    rects,
    &mut rect_count,
    [panel_x, panel_y + panel_h - border],
    [panel_w, border],
    [0.78, 0.62, 0.34],
    1.0,
  ) {
    dropped_rects += 1;
  }
  if !push_rect(
    rects,
    &mut rect_count,
    [panel_x, panel_y],
    [border, panel_h],
    [0.78, 0.62, 0.34],
    1.0,
  ) {
    dropped_rects += 1;
  }
  if !push_rect(
    rects,
    &mut rect_count,
    [panel_x + panel_w - border, panel_y],
    [border, panel_h],
    [0.78, 0.62, 0.34],
    1.0,
  ) {
    dropped_rects += 1;
  }

  if !push_draw_cmd(
    draw_cmds,
    &mut draw_count,
    ProgramId::Rect,
    0,
    rect_count,
  ) {
    dropped_draw_cmds += 1;
  }

  for (i, ch) in text.chars().enumerate() {
    if !push_glyph(
      glyphs,
      &mut glyph_count,
      [text_x + i as f32 * 8.0 * scale, text_y],
      text_size,
      glyph_uv_rect(ch as u32),
      [0.96, 0.90, 0.72],
      1.0,
    ) {
      dropped_glyphs += 1;
    }
  }

  if !push_draw_cmd(
    draw_cmds,
    &mut draw_count,
    ProgramId::Text,
    0,
    glyph_count,
  ) {
    dropped_draw_cmds += 1;
  }

  Phase0FrameCounts {
    rects: rect_count,
    glyphs: glyph_count,
    draw_cmds: draw_count,
    dropped_rects,
    dropped_glyphs,
    dropped_draw_cmds,
  }
}

#[cfg(test)]
mod tests {
  use od_core::{DRAWCMD_PROGRAM_RECT, DRAWCMD_PROGRAM_TEXT};

  use super::*;

  #[test]
  fn demo_frame_emits_bordered_rect_and_hello() {
    let mut rects = vec![RectInstance::default(); 8];
    let mut glyphs = vec![GlyphInstance::default(); 8];
    let mut draw_cmds = vec![DrawCmd::default(); 4];
    let counts = build_phase0_demo_frame(
      800,
      600,
      1.0,
      &mut rects,
      &mut glyphs,
      &mut draw_cmds,
    );

    assert_eq!(counts.rects, 5);
    assert_eq!(counts.glyphs, 5);
    assert_eq!(counts.draw_cmds, 2);
    assert_eq!(draw_cmds[0].program, DRAWCMD_PROGRAM_RECT);
    assert_eq!(draw_cmds[1].program, DRAWCMD_PROGRAM_TEXT);
  }
}
