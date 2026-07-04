#![warn(clippy::pedantic)]

use od_core::{DrawCmd, GlyphInstance, InputArena, InputSampled, ProgramId, RectInstance};
#[cfg(target_arch = "wasm32")]
use wasm_bindgen::prelude::*;

const RECT_CAPACITY: usize = 64;
const GLYPH_CAPACITY: usize = 128;
const DRAWCMD_CAPACITY: usize = 16;

#[cfg_attr(target_arch = "wasm32", wasm_bindgen)]
pub struct UiEngine {
    rects: Vec<RectInstance>,
    glyphs: Vec<GlyphInstance>,
    draw_cmds: Vec<DrawCmd>,
    input: InputArena,
    input_state: od_ui::input::InputState,
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
            input: InputArena::default(),
            input_state: od_ui::input::InputState::default(),
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
        (&self.input as *const InputArena).cast::<u8>() as u32
    }

    pub fn input_capacity(&self) -> u32 {
        od_core::INPUT_ARENA_SIZE_BYTES
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
        od_core::DRAWCMD_SIZE_BYTES
    }

    pub fn abi_rect_stride(&self) -> u32 {
        od_core::RECT_INSTANCE_STRIDE_BYTES
    }

    pub fn abi_rect_stride_floats(&self) -> u32 {
        od_core::RECT_INSTANCE_STRIDE_FLOATS
    }

    pub fn abi_glyph_stride(&self) -> u32 {
        od_core::GLYPH_INSTANCE_STRIDE_BYTES
    }

    pub fn abi_glyph_stride_floats(&self) -> u32 {
        od_core::GLYPH_INSTANCE_STRIDE_FLOATS
    }

    pub fn abi_program_rect(&self) -> u32 {
        ProgramId::Rect.as_u32()
    }

    pub fn abi_program_text(&self) -> u32 {
        ProgramId::Text.as_u32()
    }

    pub fn frame(&mut self) -> u32 {
        self.rects.fill(RectInstance::default());
        self.glyphs.fill(GlyphInstance::default());
        self.draw_cmds.fill(DrawCmd::default());
        self.dropped_rects = 0;
        self.dropped_glyphs = 0;
        self.dropped_draw_cmds = 0;

        // `InputArena` is POD; the UI input layer expects a raw byte slice so
        // the wasm-side transport mirrors the JS `DataView` capture path.
        let input_bytes = unsafe {
            std::slice::from_raw_parts(
                (&self.input as *const InputArena).cast::<u8>(),
                od_core::INPUT_ARENA_SIZE_BYTES as usize,
            )
        };
        let _ui_intents = od_ui::input::frame(
            &mut self.input_state,
            input_bytes,
            od_ui::Focus::Linear,
        );

        let sampled: InputSampled = self.input.sampled;
        let counts = od_ui::phase0::build_phase0_demo_frame(
            sampled.framebuffer_w,
            sampled.framebuffer_h,
            sampled.dpr,
            &mut self.rects,
            &mut self.glyphs,
            &mut self.draw_cmds,
        );
        self.dropped_rects = counts.dropped_rects as u32;
        self.dropped_glyphs = counts.dropped_glyphs as u32;
        self.dropped_draw_cmds = counts.dropped_draw_cmds as u32;
        self.input.clear_queue();

        counts.draw_cmds as u32
    }
}
