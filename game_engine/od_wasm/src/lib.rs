#![warn(clippy::pedantic)]

use od_core::{
    DRAWCMD_PROGRAM_RECT, DRAWCMD_PROGRAM_TEXT, DRAWCMD_SIZE_BYTES, DrawCmd,
    GLYPH_INSTANCE_STRIDE_BYTES, GLYPH_INSTANCE_STRIDE_FLOATS, GlyphInstance,
    RECT_INSTANCE_STRIDE_BYTES, RECT_INSTANCE_STRIDE_FLOATS, RectInstance,
};
#[cfg(target_arch = "wasm32")]
use wasm_bindgen::prelude::*;

const RECT_CAPACITY: usize = 64;
const GLYPH_CAPACITY: usize = 128;
const DRAWCMD_CAPACITY: usize = 16;
const INPUT_CAPACITY: usize = 64;

const INPUT_FRAMEBUFFER_WIDTH_OFFSET: usize = 0;
const INPUT_FRAMEBUFFER_HEIGHT_OFFSET: usize = 4;
const INPUT_DPR_OFFSET: usize = 8;

fn read_u32_le(bytes: &[u8], offset: usize) -> u32 {
    let Some(chunk) = bytes.get(offset..offset + 4) else {
        return 0;
    };
    let mut buffer = [0_u8; 4];
    buffer.copy_from_slice(chunk);
    u32::from_le_bytes(buffer)
}

fn read_f32_le(bytes: &[u8], offset: usize) -> f32 {
    let Some(chunk) = bytes.get(offset..offset + 4) else {
        return 1.0;
    };
    let mut buffer = [0_u8; 4];
    buffer.copy_from_slice(chunk);
    f32::from_le_bytes(buffer)
}

#[cfg_attr(target_arch = "wasm32", wasm_bindgen)]
pub struct UiEngine {
    rects: Vec<RectInstance>,
    glyphs: Vec<GlyphInstance>,
    draw_cmds: Vec<DrawCmd>,
    input: Vec<u8>,
    dropped_rects: u32,
    dropped_glyphs: u32,
    dropped_draw_cmds: u32,
}

#[cfg_attr(target_arch = "wasm32", wasm_bindgen)]
impl UiEngine {
    #[cfg_attr(target_arch = "wasm32", wasm_bindgen(constructor))]
    pub fn new() -> Self {
        Self {
            rects: vec![RectInstance::default(); RECT_CAPACITY],
            glyphs: vec![GlyphInstance::default(); GLYPH_CAPACITY],
            draw_cmds: vec![DrawCmd::default(); DRAWCMD_CAPACITY],
            input: vec![0_u8; INPUT_CAPACITY],
            dropped_rects: 0,
            dropped_glyphs: 0,
            dropped_draw_cmds: 0,
        }
    }

    pub fn rect_ptr(&self) -> u32 {
        self.rects.as_ptr() as u32
    }

    pub fn rect_capacity(&self) -> u32 {
        self.rects.len() as u32
    }

    pub fn glyph_ptr(&self) -> u32 {
        self.glyphs.as_ptr() as u32
    }

    pub fn glyph_capacity(&self) -> u32 {
        self.glyphs.len() as u32
    }

    pub fn drawlist_ptr(&self) -> u32 {
        self.draw_cmds.as_ptr() as *const u8 as u32
    }

    pub fn drawlist_capacity(&self) -> u32 {
        self.draw_cmds.len() as u32
    }

    pub fn input_ptr(&self) -> u32 {
        self.input.as_ptr() as u32
    }

    pub fn input_capacity(&self) -> u32 {
        self.input.len() as u32
    }

    pub fn dropped_rects(&self) -> u32 {
        self.dropped_rects
    }

    pub fn dropped_glyphs(&self) -> u32 {
        self.dropped_glyphs
    }

    pub fn dropped_draw_cmds(&self) -> u32 {
        self.dropped_draw_cmds
    }

    pub fn abi_drawcmd_stride(&self) -> u32 {
        DRAWCMD_SIZE_BYTES
    }

    pub fn abi_rect_stride(&self) -> u32 {
        RECT_INSTANCE_STRIDE_BYTES
    }

    pub fn abi_rect_stride_floats(&self) -> u32 {
        RECT_INSTANCE_STRIDE_FLOATS
    }

    pub fn abi_glyph_stride(&self) -> u32 {
        GLYPH_INSTANCE_STRIDE_BYTES
    }

    pub fn abi_glyph_stride_floats(&self) -> u32 {
        GLYPH_INSTANCE_STRIDE_FLOATS
    }

    pub fn abi_program_rect(&self) -> u32 {
        DRAWCMD_PROGRAM_RECT
    }

    pub fn abi_program_text(&self) -> u32 {
        DRAWCMD_PROGRAM_TEXT
    }

    pub fn frame(&mut self) -> u32 {
        self.rects.fill(RectInstance::default());
        self.glyphs.fill(GlyphInstance::default());
        self.draw_cmds.fill(DrawCmd::default());
        self.dropped_rects = 0;
        self.dropped_glyphs = 0;
        self.dropped_draw_cmds = 0;

        let framebuffer_w = read_u32_le(&self.input, INPUT_FRAMEBUFFER_WIDTH_OFFSET);
        let framebuffer_h = read_u32_le(&self.input, INPUT_FRAMEBUFFER_HEIGHT_OFFSET);
        let dpr = read_f32_le(&self.input, INPUT_DPR_OFFSET);
        let counts = od_ui::phase0::build_phase0_demo_frame(
            framebuffer_w,
            framebuffer_h,
            dpr,
            &mut self.rects,
            &mut self.glyphs,
            &mut self.draw_cmds,
        );
        self.dropped_rects = counts.dropped_rects as u32;
        self.dropped_glyphs = counts.dropped_glyphs as u32;
        self.dropped_draw_cmds = counts.dropped_draw_cmds as u32;

        counts.draw_cmds as u32
    }
}
