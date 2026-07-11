#![warn(clippy::pedantic)]

use od_core::{InputArena, ProgramId};
#[cfg(target_arch = "wasm32")]
use od_ui::HostEffect;
use od_ui::{DomainEngine, MonospaceVga};
#[cfg(target_arch = "wasm32")]
use wasm_bindgen::prelude::*;

#[cfg(target_arch = "wasm32")]
#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(js_namespace = globalThis)]
    fn host_leave_game();

    #[wasm_bindgen(js_namespace = globalThis)]
    fn host_persist_settings(ptr: u32, len: u32);

    #[wasm_bindgen(js_namespace = globalThis)]
    fn host_set_text_capture(active: u32, x: f32, y: f32, w: f32, h: f32, max_len: u32);
}

#[cfg_attr(target_arch = "wasm32", wasm_bindgen)]
pub struct UiEngine {
    engine: DomainEngine<MonospaceVga>,
    input: InputArena,
}

#[cfg_attr(target_arch = "wasm32", wasm_bindgen)]
impl UiEngine {
    #[cfg_attr(target_arch = "wasm32", wasm_bindgen(constructor))]
    pub fn new() -> Self {
        Self {
            engine: DomainEngine::new(),
            input: InputArena::default(),
        }
    }

    pub fn rect_ptr(&self) -> u32 {
        self.engine.rect_ptr()
    }

    pub fn rect_capacity(&self) -> u32 {
        self.engine.rect_capacity()
    }

    pub fn glyph_ptr(&self) -> u32 {
        self.engine.glyph_ptr()
    }

    pub fn glyph_capacity(&self) -> u32 {
        self.engine.glyph_capacity()
    }

    pub fn drawlist_ptr(&self) -> u32 {
        self.engine.drawlist_ptr()
    }

    pub fn drawlist_capacity(&self) -> u32 {
        self.engine.drawlist_capacity()
    }

    pub fn input_ptr(&self) -> u32 {
        (&self.input as *const InputArena).cast::<u8>() as u32
    }

    pub fn input_capacity(&self) -> u32 {
        od_core::INPUT_ARENA_SIZE_BYTES
    }

    pub fn dropped_rects(&self) -> u32 {
        self.engine.dropped_rects()
    }

    pub fn dropped_glyphs(&self) -> u32 {
        self.engine.dropped_glyphs()
    }

    pub fn dropped_draw_cmds(&self) -> u32 {
        self.engine.dropped_draw_cmds()
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

    pub fn debug_snapshot_json(&self) -> String {
        self.engine.debug_snapshot_json()
    }

    /// Compute-on-call draw hash (`"fnv1a64:<hex>"`). Not paid on the RAF path.
    pub fn debug_draw_hash(&self) -> String {
        self.engine.debug_draw_hash()
    }

    pub fn hydrate_settings(&mut self, bytes: &[u8]) {
        self.engine.hydrate_settings(bytes);
    }

    pub fn frame(&mut self) -> u32 {
        let input_bytes = unsafe {
            std::slice::from_raw_parts(
                (&self.input as *const InputArena).cast::<u8>(),
                od_core::INPUT_ARENA_SIZE_BYTES as usize,
            )
        };
        let out = self.engine.frame(input_bytes);
        self.input.clear_queue();

        #[cfg(target_arch = "wasm32")]
        {
            for effect in out.host_effects {
                dispatch_host_effect(effect);
            }
        }

        out.draw_list_count
    }
}

#[cfg(target_arch = "wasm32")]
fn dispatch_host_effect(effect: HostEffect) {
    match effect {
        HostEffect::LeaveGame => host_leave_game(),
        HostEffect::PersistSettings(bytes) => {
            host_persist_settings(bytes.as_ptr() as u32, bytes.len() as u32);
        }
        HostEffect::SetTextCapture {
            active,
            x,
            y,
            w,
            h,
            max_len,
        } => host_set_text_capture(u32::from(active), x, y, w, h, max_len),
    }
}
