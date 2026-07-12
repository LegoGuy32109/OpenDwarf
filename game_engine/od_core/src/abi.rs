use bytemuck::{Pod, Zeroable};
use serde::{Deserialize, Serialize};
use std::mem;

#[cfg(not(target_arch = "wasm32"))]
use std::path::Path;

use crate::input::{
    INPUT_ARENA_EVENTS_OFFSET, INPUT_ARENA_QUEUE_OFFSET, INPUT_ARENA_SAMPLE_OFFSET,
    INPUT_ARENA_SIZE_BYTES, INPUT_EVENT_CODE_OFFSET, INPUT_EVENT_KIND_OFFSET,
    INPUT_EVENT_MODIFIERS_OFFSET, INPUT_EVENT_SIZE_BYTES, INPUT_EVENT_VALUE_OFFSET,
    INPUT_KIND_BLUR, INPUT_KIND_COMPOSITION, INPUT_KIND_KEY_DOWN, INPUT_KIND_KEY_UP,
    INPUT_KIND_RESYNC, INPUT_KIND_TEXT, INPUT_KIND_UNKNOWN, INPUT_MODIFIER_ALT,
    INPUT_MODIFIER_CTRL, INPUT_MODIFIER_META, INPUT_MODIFIER_SHIFT, INPUT_QUEUE_CAPACITY,
    INPUT_QUEUE_HEADER_COUNT_OFFSET, INPUT_QUEUE_HEADER_OVERFLOW_OFFSET,
    INPUT_QUEUE_HEADER_SIZE_BYTES, INPUT_SAMPLE_BUTTONS_OFFSET, INPUT_SAMPLE_DPR_OFFSET,
    INPUT_SAMPLE_DT_MS_OFFSET, INPUT_SAMPLE_FRAMEBUFFER_H_OFFSET,
    INPUT_SAMPLE_FRAMEBUFFER_W_OFFSET, INPUT_SAMPLE_POINTER_X_OFFSET,
    INPUT_SAMPLE_POINTER_Y_OFFSET, INPUT_SAMPLE_WINDOW_FOCUSED_OFFSET, INPUT_SAMPLED_SIZE_BYTES,
};
use crate::keycode::KeyCode;

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

pub const VIEW_GLOBALS_SIZE_BYTES: u32 = 48;
pub const VIEW_GLOBALS_CAMERA_OFFSET: usize = 0;
pub const VIEW_GLOBALS_CANVAS_OFFSET: usize = 16;
pub const VIEW_GLOBALS_SIM_OFFSET: usize = 32;

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

/// UBO-ready view globals (`std140`-friendly vec4 slots).
///
/// `camera = [x, y, zoom, _]`, `canvas = [w, h, dpr, _]`,
/// `sim = [tick, view_z, view_mode, _]`.
#[repr(C)]
#[derive(Clone, Copy, Debug, Default, Pod, Zeroable, Serialize, Deserialize)]
pub struct ViewGlobals {
    pub camera: [f32; 4],
    pub canvas: [f32; 4],
    pub sim: [f32; 4],
}

const _: () = assert!(mem::size_of::<DrawCmd>() == DRAWCMD_SIZE_BYTES as usize);
const _: () = assert!(mem::offset_of!(DrawCmd, program) == DRAWCMD_PROGRAM_OFFSET);
const _: () = assert!(mem::offset_of!(DrawCmd, instance_offset) == DRAWCMD_INSTANCE_OFFSET_OFFSET,);
const _: () = assert!(mem::offset_of!(DrawCmd, instance_count) == DRAWCMD_INSTANCE_COUNT_OFFSET,);
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

const _: () = assert!(mem::size_of::<ViewGlobals>() == VIEW_GLOBALS_SIZE_BYTES as usize);
const _: () = assert!(mem::offset_of!(ViewGlobals, camera) == VIEW_GLOBALS_CAMERA_OFFSET);
const _: () = assert!(mem::offset_of!(ViewGlobals, canvas) == VIEW_GLOBALS_CANVAS_OFFSET);
const _: () = assert!(mem::offset_of!(ViewGlobals, sim) == VIEW_GLOBALS_SIM_OFFSET);

pub fn ts_abi_source() -> String {
    let mut out = String::new();
    out.push_str("/* eslint-disable */\n");
    out.push_str("// This file is generated from game_engine/od_core. Do not edit by hand.\n");
    out.push_str("export const ABI = Object.freeze({\n");
    out.push_str(&format!("  DRAWCMD_SIZE_BYTES: {},\n", DRAWCMD_SIZE_BYTES));
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
    out.push_str(&format!(
        "  VIEW_GLOBALS_SIZE_BYTES: {},\n",
        VIEW_GLOBALS_SIZE_BYTES
    ));
    out.push_str(&format!(
        "  VIEW_GLOBALS_CAMERA_OFFSET: {},\n",
        VIEW_GLOBALS_CAMERA_OFFSET
    ));
    out.push_str(&format!(
        "  VIEW_GLOBALS_CANVAS_OFFSET: {},\n",
        VIEW_GLOBALS_CANVAS_OFFSET
    ));
    out.push_str(&format!(
        "  VIEW_GLOBALS_SIM_OFFSET: {},\n",
        VIEW_GLOBALS_SIM_OFFSET
    ));
    out.push_str(&format!(
        "  INPUT_SAMPLED_SIZE_BYTES: {},\n",
        INPUT_SAMPLED_SIZE_BYTES
    ));
    out.push_str(&format!(
        "  INPUT_SAMPLE_FRAMEBUFFER_W_OFFSET: {},\n",
        INPUT_SAMPLE_FRAMEBUFFER_W_OFFSET
    ));
    out.push_str(&format!(
        "  INPUT_SAMPLE_FRAMEBUFFER_H_OFFSET: {},\n",
        INPUT_SAMPLE_FRAMEBUFFER_H_OFFSET
    ));
    out.push_str(&format!(
        "  INPUT_SAMPLE_DPR_OFFSET: {},\n",
        INPUT_SAMPLE_DPR_OFFSET
    ));
    out.push_str(&format!(
        "  INPUT_SAMPLE_DT_MS_OFFSET: {},\n",
        INPUT_SAMPLE_DT_MS_OFFSET
    ));
    out.push_str(&format!(
        "  INPUT_SAMPLE_WINDOW_FOCUSED_OFFSET: {},\n",
        INPUT_SAMPLE_WINDOW_FOCUSED_OFFSET
    ));
    out.push_str(&format!(
        "  INPUT_SAMPLE_POINTER_X_OFFSET: {},\n",
        INPUT_SAMPLE_POINTER_X_OFFSET
    ));
    out.push_str(&format!(
        "  INPUT_SAMPLE_POINTER_Y_OFFSET: {},\n",
        INPUT_SAMPLE_POINTER_Y_OFFSET
    ));
    out.push_str(&format!(
        "  INPUT_SAMPLE_BUTTONS_OFFSET: {},\n",
        INPUT_SAMPLE_BUTTONS_OFFSET
    ));
    out.push_str(&format!(
        "  INPUT_QUEUE_HEADER_SIZE_BYTES: {},\n",
        INPUT_QUEUE_HEADER_SIZE_BYTES
    ));
    out.push_str(&format!(
        "  INPUT_QUEUE_HEADER_COUNT_OFFSET: {},\n",
        INPUT_QUEUE_HEADER_COUNT_OFFSET
    ));
    out.push_str(&format!(
        "  INPUT_QUEUE_HEADER_OVERFLOW_OFFSET: {},\n",
        INPUT_QUEUE_HEADER_OVERFLOW_OFFSET
    ));
    out.push_str(&format!(
        "  INPUT_EVENT_SIZE_BYTES: {},\n",
        INPUT_EVENT_SIZE_BYTES
    ));
    out.push_str(&format!(
        "  INPUT_EVENT_KIND_OFFSET: {},\n",
        INPUT_EVENT_KIND_OFFSET
    ));
    out.push_str(&format!(
        "  INPUT_EVENT_MODIFIERS_OFFSET: {},\n",
        INPUT_EVENT_MODIFIERS_OFFSET
    ));
    out.push_str(&format!(
        "  INPUT_EVENT_CODE_OFFSET: {},\n",
        INPUT_EVENT_CODE_OFFSET
    ));
    out.push_str(&format!(
        "  INPUT_EVENT_VALUE_OFFSET: {},\n",
        INPUT_EVENT_VALUE_OFFSET
    ));
    out.push_str(&format!(
        "  INPUT_QUEUE_CAPACITY: {},\n",
        INPUT_QUEUE_CAPACITY
    ));
    out.push_str(&format!(
        "  INPUT_ARENA_SAMPLE_OFFSET: {},\n",
        INPUT_ARENA_SAMPLE_OFFSET
    ));
    out.push_str(&format!(
        "  INPUT_ARENA_QUEUE_OFFSET: {},\n",
        INPUT_ARENA_QUEUE_OFFSET
    ));
    out.push_str(&format!(
        "  INPUT_ARENA_EVENTS_OFFSET: {},\n",
        INPUT_ARENA_EVENTS_OFFSET
    ));
    out.push_str(&format!(
        "  INPUT_ARENA_SIZE_BYTES: {},\n",
        INPUT_ARENA_SIZE_BYTES
    ));
    out.push_str(&format!("  INPUT_KIND_UNKNOWN: {},\n", INPUT_KIND_UNKNOWN));
    out.push_str(&format!(
        "  INPUT_KIND_KEY_DOWN: {},\n",
        INPUT_KIND_KEY_DOWN
    ));
    out.push_str(&format!("  INPUT_KIND_KEY_UP: {},\n", INPUT_KIND_KEY_UP));
    out.push_str(&format!("  INPUT_KIND_BLUR: {},\n", INPUT_KIND_BLUR));
    out.push_str(&format!("  INPUT_KIND_RESYNC: {},\n", INPUT_KIND_RESYNC));
    out.push_str(&format!("  INPUT_KIND_TEXT: {},\n", INPUT_KIND_TEXT));
    out.push_str(&format!(
        "  INPUT_KIND_COMPOSITION: {},\n",
        INPUT_KIND_COMPOSITION
    ));
    out.push_str(&format!(
        "  INPUT_MODIFIER_SHIFT: {},\n",
        INPUT_MODIFIER_SHIFT
    ));
    out.push_str(&format!(
        "  INPUT_MODIFIER_CTRL: {},\n",
        INPUT_MODIFIER_CTRL
    ));
    out.push_str(&format!("  INPUT_MODIFIER_ALT: {},\n", INPUT_MODIFIER_ALT));
    out.push_str(&format!(
        "  INPUT_MODIFIER_META: {},\n",
        INPUT_MODIFIER_META
    ));
    out.push_str(&format!(
        "  KEYCODE_UNKNOWN: {},\n",
        KeyCode::Unknown as u16
    ));
    out.push_str(&format!("  KEYCODE_ENTER: {},\n", KeyCode::Enter as u16));
    out.push_str(&format!("  KEYCODE_ESCAPE: {},\n", KeyCode::Escape as u16));
    out.push_str(&format!("  KEYCODE_SPACE: {},\n", KeyCode::Space as u16));
    out.push_str(&format!(
        "  KEYCODE_BACKSPACE: {},\n",
        KeyCode::Backspace as u16
    ));
    out.push_str(&format!("  KEYCODE_DELETE: {},\n", KeyCode::Delete as u16));
    out.push_str(&format!(
        "  KEYCODE_ARROWLEFT: {},\n",
        KeyCode::ArrowLeft as u16
    ));
    out.push_str(&format!(
        "  KEYCODE_ARROWRIGHT: {},\n",
        KeyCode::ArrowRight as u16
    ));
    out.push_str(&format!("  KEYCODE_HOME: {},\n", KeyCode::Home as u16));
    out.push_str(&format!("  KEYCODE_END: {},\n", KeyCode::End as u16));
    out.push_str(&format!("  KEYCODE_SLASH: {},\n", KeyCode::Slash as u16));
    out.push_str(&format!("  KEYCODE_KEYI: {},\n", KeyCode::KeyI as u16));
    out.push_str(&format!("  KEYCODE_KEYJ: {},\n", KeyCode::KeyJ as u16));
    out.push_str(&format!("  KEYCODE_KEYK: {},\n", KeyCode::KeyK as u16));
    out.push_str(&format!("  KEYCODE_KEYL: {},\n", KeyCode::KeyL as u16));
    out.push_str(&format!("  KEYCODE_KEYQ: {},\n", KeyCode::KeyQ as u16));
    out.push_str(&format!("  KEYCODE_KEYE: {},\n", KeyCode::KeyE as u16));
    out.push_str(&format!("  KEYCODE_KEYS: {},\n", KeyCode::KeyS as u16));
    out.push_str(&format!("  KEYCODE_KEYD: {},\n", KeyCode::KeyD as u16));
    out.push_str(&format!("  KEYCODE_KEYF: {},\n", KeyCode::KeyF as u16));
    out.push_str(&format!("  KEYCODE_KEYT: {},\n", KeyCode::KeyT as u16));
    out.push_str(&format!("  KEYCODE_KEYR: {},\n", KeyCode::KeyR as u16));
    out.push_str(&format!("  KEYCODE_KEYV: {},\n", KeyCode::KeyV as u16));
    out.push_str(&format!("  KEYCODE_KEYU: {},\n", KeyCode::KeyU as u16));
    out.push_str(&format!("  KEYCODE_KEYM: {},\n", KeyCode::KeyM as u16));
    out.push_str(&format!("  KEYCODE_DIGIT1: {},\n", KeyCode::Digit1 as u16));
    out.push_str(&format!("  KEYCODE_DIGIT2: {},\n", KeyCode::Digit2 as u16));
    out.push_str(&format!("  KEYCODE_DIGIT3: {},\n", KeyCode::Digit3 as u16));
    out.push_str(&format!("  KEYCODE_DIGIT4: {},\n", KeyCode::Digit4 as u16));
    out.push_str(&format!("  KEYCODE_DIGIT5: {},\n", KeyCode::Digit5 as u16));
    out.push_str(&format!("  KEYCODE_DIGIT6: {},\n", KeyCode::Digit6 as u16));
    out.push_str(&format!("  KEYCODE_DIGIT7: {},\n", KeyCode::Digit7 as u16));
    out.push_str(&format!("  KEYCODE_DIGIT8: {},\n", KeyCode::Digit8 as u16));
    out.push_str(&format!("  KEYCODE_DIGIT9: {},\n", KeyCode::Digit9 as u16));
    out.push_str(&format!("  KEYCODE_DIGIT0: {},\n", KeyCode::Digit0 as u16));
    out.push_str("} as const);\n");
    out.push_str(
    "export type DrawCmdProgram = typeof ABI.DRAWCMD_PROGRAM_RECT | typeof ABI.DRAWCMD_PROGRAM_TEXT;\n",
  );
    out.push_str(
        "export type EventKind = typeof ABI.INPUT_KIND_UNKNOWN | typeof ABI.INPUT_KIND_KEY_DOWN | typeof ABI.INPUT_KIND_KEY_UP | typeof ABI.INPUT_KIND_BLUR | typeof ABI.INPUT_KIND_RESYNC | typeof ABI.INPUT_KIND_TEXT | typeof ABI.INPUT_KIND_COMPOSITION;\n",
    );
    out.push_str(
        "export type KeyCode = typeof ABI.KEYCODE_UNKNOWN | typeof ABI.KEYCODE_ENTER | typeof ABI.KEYCODE_ESCAPE | typeof ABI.KEYCODE_SPACE | typeof ABI.KEYCODE_BACKSPACE | typeof ABI.KEYCODE_DELETE | typeof ABI.KEYCODE_ARROWLEFT | typeof ABI.KEYCODE_ARROWRIGHT | typeof ABI.KEYCODE_HOME | typeof ABI.KEYCODE_END | typeof ABI.KEYCODE_SLASH | typeof ABI.KEYCODE_KEYI | typeof ABI.KEYCODE_KEYJ | typeof ABI.KEYCODE_KEYK | typeof ABI.KEYCODE_KEYL | typeof ABI.KEYCODE_KEYQ | typeof ABI.KEYCODE_KEYE | typeof ABI.KEYCODE_KEYS | typeof ABI.KEYCODE_KEYD | typeof ABI.KEYCODE_KEYF | typeof ABI.KEYCODE_KEYT | typeof ABI.KEYCODE_KEYR | typeof ABI.KEYCODE_KEYV | typeof ABI.KEYCODE_KEYU | typeof ABI.KEYCODE_KEYM | typeof ABI.KEYCODE_DIGIT1 | typeof ABI.KEYCODE_DIGIT2 | typeof ABI.KEYCODE_DIGIT3 | typeof ABI.KEYCODE_DIGIT4 | typeof ABI.KEYCODE_DIGIT5 | typeof ABI.KEYCODE_DIGIT6 | typeof ABI.KEYCODE_DIGIT7 | typeof ABI.KEYCODE_DIGIT8 | typeof ABI.KEYCODE_DIGIT9 | typeof ABI.KEYCODE_DIGIT0;\n",
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
