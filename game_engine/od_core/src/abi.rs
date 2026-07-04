use bytemuck::{Pod, Zeroable};
use serde::{Deserialize, Serialize};
use std::mem;

#[cfg(not(target_arch = "wasm32"))]
use std::path::Path;

pub const DRAWCMD_PROGRAM_RECT: u32 = 0;
pub const DRAWCMD_PROGRAM_TEXT: u32 = 1;

pub const DRAWCMD_SIZE_BYTES: u32 = 32;
pub const DRAWCMD_PROGRAM_OFFSET: usize = 0;
pub const DRAWCMD_INSTANCE_OFFSET_OFFSET: usize = 4;
pub const DRAWCMD_INSTANCE_COUNT_OFFSET: usize = 8;
pub const DRAWCMD_SCISSOR_X_OFFSET: usize = 12;
pub const DRAWCMD_SCISSOR_Y_OFFSET: usize = 16;
pub const DRAWCMD_SCISSOR_W_OFFSET: usize = 20;
pub const DRAWCMD_SCISSOR_H_OFFSET: usize = 24;
pub const DRAWCMD_RESERVED_OFFSET: usize = 28;

pub const RECT_INSTANCE_STRIDE_FLOATS: u32 = 8;
pub const RECT_INSTANCE_STRIDE_BYTES: u32 = RECT_INSTANCE_STRIDE_FLOATS * 4;
pub const RECT_INSTANCE_POS_OFFSET: usize = 0;
pub const RECT_INSTANCE_SIZE_OFFSET: usize = 8;
pub const RECT_INSTANCE_TINT_OFFSET: usize = 16;
pub const RECT_INSTANCE_ALPHA_OFFSET: usize = 28;

pub const GLYPH_INSTANCE_STRIDE_FLOATS: u32 = 12;
pub const GLYPH_INSTANCE_STRIDE_BYTES: u32 = GLYPH_INSTANCE_STRIDE_FLOATS * 4;
pub const GLYPH_INSTANCE_POS_OFFSET: usize = 0;
pub const GLYPH_INSTANCE_SIZE_OFFSET: usize = 8;
pub const GLYPH_INSTANCE_UV_OFFSET: usize = 16;
pub const GLYPH_INSTANCE_TINT_OFFSET: usize = 32;
pub const GLYPH_INSTANCE_ALPHA_OFFSET: usize = 44;

#[repr(u32)]
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub enum ProgramId {
  Rect = DRAWCMD_PROGRAM_RECT,
  Text = DRAWCMD_PROGRAM_TEXT,
}

impl ProgramId {
  pub const fn as_u32(self) -> u32 {
    self as u32
  }
}

#[repr(C)]
#[derive(Clone, Copy, Debug, Default, Pod, Zeroable, Serialize, Deserialize)]
pub struct RectInstance {
  pub pos: [f32; 2],
  pub size: [f32; 2],
  pub tint: [f32; 3],
  pub alpha: f32,
}

#[repr(C)]
#[derive(Clone, Copy, Debug, Default, Pod, Zeroable, Serialize, Deserialize)]
pub struct GlyphInstance {
  pub pos: [f32; 2],
  pub size: [f32; 2],
  pub uv_rect: [f32; 4],
  pub tint: [f32; 3],
  pub alpha: f32,
}

#[repr(C)]
#[derive(Clone, Copy, Debug, Default, Pod, Zeroable, Serialize, Deserialize)]
pub struct DrawCmd {
  pub program: u32,
  pub instance_offset: u32,
  pub instance_count: u32,
  pub scissor_x: i32,
  pub scissor_y: i32,
  pub scissor_w: i32,
  pub scissor_h: i32,
  pub reserved: u32,
}

const _: () = assert!(mem::size_of::<DrawCmd>() == DRAWCMD_SIZE_BYTES as usize);
const _: () = assert!(mem::offset_of!(DrawCmd, program) == DRAWCMD_PROGRAM_OFFSET);
const _: () = assert!(
  mem::offset_of!(DrawCmd, instance_offset) == DRAWCMD_INSTANCE_OFFSET_OFFSET,
);
const _: () = assert!(
  mem::offset_of!(DrawCmd, instance_count) == DRAWCMD_INSTANCE_COUNT_OFFSET,
);
const _: () = assert!(mem::offset_of!(DrawCmd, scissor_x) == DRAWCMD_SCISSOR_X_OFFSET);
const _: () = assert!(mem::offset_of!(DrawCmd, scissor_y) == DRAWCMD_SCISSOR_Y_OFFSET);
const _: () = assert!(mem::offset_of!(DrawCmd, scissor_w) == DRAWCMD_SCISSOR_W_OFFSET);
const _: () = assert!(mem::offset_of!(DrawCmd, scissor_h) == DRAWCMD_SCISSOR_H_OFFSET);
const _: () = assert!(mem::offset_of!(DrawCmd, reserved) == DRAWCMD_RESERVED_OFFSET);

const _: () = assert!(mem::size_of::<RectInstance>() == RECT_INSTANCE_STRIDE_BYTES as usize);
const _: () = assert!(mem::offset_of!(RectInstance, pos) == RECT_INSTANCE_POS_OFFSET);
const _: () = assert!(mem::offset_of!(RectInstance, size) == RECT_INSTANCE_SIZE_OFFSET);
const _: () = assert!(mem::offset_of!(RectInstance, tint) == RECT_INSTANCE_TINT_OFFSET);
const _: () = assert!(mem::offset_of!(RectInstance, alpha) == RECT_INSTANCE_ALPHA_OFFSET);

const _: () = assert!(mem::size_of::<GlyphInstance>() == GLYPH_INSTANCE_STRIDE_BYTES as usize);
const _: () = assert!(mem::offset_of!(GlyphInstance, pos) == GLYPH_INSTANCE_POS_OFFSET);
const _: () = assert!(mem::offset_of!(GlyphInstance, size) == GLYPH_INSTANCE_SIZE_OFFSET);
const _: () = assert!(mem::offset_of!(GlyphInstance, uv_rect) == GLYPH_INSTANCE_UV_OFFSET);
const _: () = assert!(mem::offset_of!(GlyphInstance, tint) == GLYPH_INSTANCE_TINT_OFFSET);
const _: () = assert!(mem::offset_of!(GlyphInstance, alpha) == GLYPH_INSTANCE_ALPHA_OFFSET);

pub fn ts_abi_source() -> String {
  let mut out = String::new();
  out.push_str("/* eslint-disable */\n");
  out.push_str("// This file is generated from game_engine/od_core. Do not edit by hand.\n");
  out.push_str("export const ABI = Object.freeze({\n");
  out.push_str(&format!(
    "  DRAWCMD_SIZE_BYTES: {},\n",
    DRAWCMD_SIZE_BYTES
  ));
  out.push_str(&format!(
    "  DRAWCMD_PROGRAM_RECT: {},\n",
    DRAWCMD_PROGRAM_RECT
  ));
  out.push_str(&format!(
    "  DRAWCMD_PROGRAM_TEXT: {},\n",
    DRAWCMD_PROGRAM_TEXT
  ));
  out.push_str(&format!(
    "  DRAWCMD_PROGRAM_OFFSET: {},\n",
    DRAWCMD_PROGRAM_OFFSET
  ));
  out.push_str(&format!(
    "  DRAWCMD_INSTANCE_OFFSET_OFFSET: {},\n",
    DRAWCMD_INSTANCE_OFFSET_OFFSET
  ));
  out.push_str(&format!(
    "  DRAWCMD_INSTANCE_COUNT_OFFSET: {},\n",
    DRAWCMD_INSTANCE_COUNT_OFFSET
  ));
  out.push_str(&format!(
    "  DRAWCMD_SCISSOR_X_OFFSET: {},\n",
    DRAWCMD_SCISSOR_X_OFFSET
  ));
  out.push_str(&format!(
    "  DRAWCMD_SCISSOR_Y_OFFSET: {},\n",
    DRAWCMD_SCISSOR_Y_OFFSET
  ));
  out.push_str(&format!(
    "  DRAWCMD_SCISSOR_W_OFFSET: {},\n",
    DRAWCMD_SCISSOR_W_OFFSET
  ));
  out.push_str(&format!(
    "  DRAWCMD_SCISSOR_H_OFFSET: {},\n",
    DRAWCMD_SCISSOR_H_OFFSET
  ));
  out.push_str(&format!(
    "  DRAWCMD_RESERVED_OFFSET: {},\n",
    DRAWCMD_RESERVED_OFFSET
  ));
  out.push_str(&format!(
    "  RECT_INSTANCE_STRIDE_FLOATS: {},\n",
    RECT_INSTANCE_STRIDE_FLOATS
  ));
  out.push_str(&format!(
    "  RECT_INSTANCE_STRIDE_BYTES: {},\n",
    RECT_INSTANCE_STRIDE_BYTES
  ));
  out.push_str(&format!(
    "  RECT_INSTANCE_POS_OFFSET: {},\n",
    RECT_INSTANCE_POS_OFFSET
  ));
  out.push_str(&format!(
    "  RECT_INSTANCE_SIZE_OFFSET: {},\n",
    RECT_INSTANCE_SIZE_OFFSET
  ));
  out.push_str(&format!(
    "  RECT_INSTANCE_TINT_OFFSET: {},\n",
    RECT_INSTANCE_TINT_OFFSET
  ));
  out.push_str(&format!(
    "  RECT_INSTANCE_ALPHA_OFFSET: {},\n",
    RECT_INSTANCE_ALPHA_OFFSET
  ));
  out.push_str(&format!(
    "  GLYPH_INSTANCE_STRIDE_FLOATS: {},\n",
    GLYPH_INSTANCE_STRIDE_FLOATS
  ));
  out.push_str(&format!(
    "  GLYPH_INSTANCE_STRIDE_BYTES: {},\n",
    GLYPH_INSTANCE_STRIDE_BYTES
  ));
  out.push_str(&format!(
    "  GLYPH_INSTANCE_POS_OFFSET: {},\n",
    GLYPH_INSTANCE_POS_OFFSET
  ));
  out.push_str(&format!(
    "  GLYPH_INSTANCE_SIZE_OFFSET: {},\n",
    GLYPH_INSTANCE_SIZE_OFFSET
  ));
  out.push_str(&format!(
    "  GLYPH_INSTANCE_UV_OFFSET: {},\n",
    GLYPH_INSTANCE_UV_OFFSET
  ));
  out.push_str(&format!(
    "  GLYPH_INSTANCE_TINT_OFFSET: {},\n",
    GLYPH_INSTANCE_TINT_OFFSET
  ));
  out.push_str(&format!(
    "  GLYPH_INSTANCE_ALPHA_OFFSET: {},\n",
    GLYPH_INSTANCE_ALPHA_OFFSET
  ));
  out.push_str("} as const);\n");
  out.push_str(
    "export type DrawCmdProgram = typeof ABI.DRAWCMD_PROGRAM_RECT | typeof ABI.DRAWCMD_PROGRAM_TEXT;\n",
  );
  out
}

#[cfg(not(target_arch = "wasm32"))]
pub fn write_ts_abi_file(path: impl AsRef<Path>) -> std::io::Result<()> {
  if let Some(parent) = path.as_ref().parent() {
    std::fs::create_dir_all(parent)?;
  }
  std::fs::write(path, ts_abi_source())
}
