//! Deterministic state hashing shared across native tests and wasm.
//!
//! `StateHash` is a tagged hex string so the algorithm can evolve without
//! ambiguous bare hex. Draw hashing covers the used prefixes of the frame
//! draw list (`DrawCmd` + `RectInstance` + `GlyphInstance`) in that order.

use std::hash::Hasher;

use bytemuck::bytes_of;

use crate::abi::{
    DrawCmd, GlyphInstance, RectInstance, WorldAtlasQuadInstance, WorldSolidQuadInstance,
};

/// FNV-1a 64-bit offset basis (same constant historically used in `od_ui::id`).
pub const FNV_OFFSET_BASIS: u64 = 0xcbf29ce484222325;
/// FNV-1a 64-bit prime.
pub const FNV_PRIME: u64 = 0x100000001b3;

/// Tagged hash string, e.g. `"fnv1a64:0123456789abcdef"`.
pub type StateHash = String;

/// FNV-1a 64-bit hasher used for widget ids and draw/world state hashes.
#[derive(Clone, Copy, Debug)]
pub struct FnvHasher {
    state: u64,
}

impl Default for FnvHasher {
    fn default() -> Self {
        Self::new()
    }
}

impl FnvHasher {
    #[must_use]
    pub const fn new() -> Self {
        Self {
            state: FNV_OFFSET_BASIS,
        }
    }

    #[must_use]
    pub const fn with_offset(state: u64) -> Self {
        Self { state }
    }
}

impl Hasher for FnvHasher {
    fn finish(&self) -> u64 {
        self.state
    }

    fn write(&mut self, bytes: &[u8]) {
        for byte in bytes {
            self.state ^= u64::from(*byte);
            self.state = self.state.wrapping_mul(FNV_PRIME);
        }
    }
}

/// Format a raw 64-bit digest as a tagged [`StateHash`].
#[must_use]
pub fn format_state_hash(digest: u64) -> StateHash {
    format!("fnv1a64:{digest:016x}")
}

/// Canonicalize signed zero so native and wasm agree bit-for-bit.
#[must_use]
pub fn canonicalize_f32(value: f32) -> f32 {
    if value == 0.0 { 0.0 } else { value }
}

fn write_f32(hasher: &mut FnvHasher, value: f32) {
    hasher.write(&canonicalize_f32(value).to_le_bytes());
}

fn write_rect(hasher: &mut FnvHasher, rect: &RectInstance) {
    write_f32(hasher, rect.pos[0]);
    write_f32(hasher, rect.pos[1]);
    write_f32(hasher, rect.size[0]);
    write_f32(hasher, rect.size[1]);
    write_f32(hasher, rect.tint[0]);
    write_f32(hasher, rect.tint[1]);
    write_f32(hasher, rect.tint[2]);
    write_f32(hasher, rect.alpha);
}

fn write_glyph(hasher: &mut FnvHasher, glyph: &GlyphInstance) {
    write_f32(hasher, glyph.pos[0]);
    write_f32(hasher, glyph.pos[1]);
    write_f32(hasher, glyph.size[0]);
    write_f32(hasher, glyph.size[1]);
    write_f32(hasher, glyph.uv_rect[0]);
    write_f32(hasher, glyph.uv_rect[1]);
    write_f32(hasher, glyph.uv_rect[2]);
    write_f32(hasher, glyph.uv_rect[3]);
    write_f32(hasher, glyph.tint[0]);
    write_f32(hasher, glyph.tint[1]);
    write_f32(hasher, glyph.tint[2]);
    write_f32(hasher, glyph.alpha);
}

fn write_world_atlas_quad(hasher: &mut FnvHasher, quad: &WorldAtlasQuadInstance) {
    write_f32(hasher, quad.pos[0]);
    write_f32(hasher, quad.pos[1]);
    write_f32(hasher, quad.size[0]);
    write_f32(hasher, quad.size[1]);
    write_f32(hasher, quad.uv_rect[0]);
    write_f32(hasher, quad.uv_rect[1]);
    write_f32(hasher, quad.uv_rect[2]);
    write_f32(hasher, quad.uv_rect[3]);
    write_f32(hasher, quad.tint[0]);
    write_f32(hasher, quad.tint[1]);
    write_f32(hasher, quad.tint[2]);
    write_f32(hasher, quad.alpha);
}

fn write_world_solid_quad(hasher: &mut FnvHasher, quad: &WorldSolidQuadInstance) {
    write_f32(hasher, quad.pos[0]);
    write_f32(hasher, quad.pos[1]);
    write_f32(hasher, quad.size[0]);
    write_f32(hasher, quad.size[1]);
    write_f32(hasher, quad.tint[0]);
    write_f32(hasher, quad.tint[1]);
    write_f32(hasher, quad.tint[2]);
    write_f32(hasher, quad.alpha);
}

/// Deterministic FNV-1a hash of the frame's draw output (GPU-independent).
///
/// Hashes `draw_cmds`, then `rects`, then `glyphs`, in order, including full
/// `DrawCmd` fields (program, offsets, counts, and scissor).
#[must_use]
pub fn draw_hash(draw_cmds: &[DrawCmd], rects: &[RectInstance], glyphs: &[GlyphInstance]) -> u64 {
    let mut hasher = FnvHasher::new();
    for cmd in draw_cmds {
        hasher.write(bytes_of(cmd));
    }
    for rect in rects {
        write_rect(&mut hasher, rect);
    }
    for glyph in glyphs {
        write_glyph(&mut hasher, glyph);
    }
    hasher.finish()
}

/// Convenience: [`draw_hash`] formatted as a [`StateHash`].
#[must_use]
pub fn draw_state_hash(
    draw_cmds: &[DrawCmd],
    rects: &[RectInstance],
    glyphs: &[GlyphInstance],
) -> StateHash {
    format_state_hash(draw_hash(draw_cmds, rects, glyphs))
}

/// Deterministic FNV-1a hash of the full engine draw output, including world arenas.
#[must_use]
pub fn draw_hash_with_world(
    draw_cmds: &[DrawCmd],
    rects: &[RectInstance],
    glyphs: &[GlyphInstance],
    world_atlas_quads: &[WorldAtlasQuadInstance],
    world_solid_quads: &[WorldSolidQuadInstance],
) -> u64 {
    let mut hasher = FnvHasher::new();
    for cmd in draw_cmds {
        hasher.write(bytes_of(cmd));
    }
    for atlas in world_atlas_quads {
        write_world_atlas_quad(&mut hasher, atlas);
    }
    for solid in world_solid_quads {
        write_world_solid_quad(&mut hasher, solid);
    }
    for rect in rects {
        write_rect(&mut hasher, rect);
    }
    for glyph in glyphs {
        write_glyph(&mut hasher, glyph);
    }
    hasher.finish()
}

/// Convenience: [`draw_hash_with_world`] formatted as a [`StateHash`].
#[must_use]
pub fn draw_state_hash_with_world(
    draw_cmds: &[DrawCmd],
    rects: &[RectInstance],
    glyphs: &[GlyphInstance],
    world_atlas_quads: &[WorldAtlasQuadInstance],
    world_solid_quads: &[WorldSolidQuadInstance],
) -> StateHash {
    format_state_hash(draw_hash_with_world(
        draw_cmds,
        rects,
        glyphs,
        world_atlas_quads,
        world_solid_quads,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_draw_hash_is_stable() {
        let hash = draw_hash(&[], &[], &[]);
        assert_eq!(format_state_hash(hash), "fnv1a64:cbf29ce484222325");
    }

    #[test]
    fn state_hash_format_is_tagged() {
        assert_eq!(format_state_hash(0), "fnv1a64:0000000000000000");
        assert_eq!(
            format_state_hash(0x0123_4567_89ab_cdef),
            "fnv1a64:0123456789abcdef"
        );
    }

    #[test]
    fn scissor_bytes_affect_hash() {
        let base = DrawCmd {
            program: 0,
            instance_offset: 0,
            instance_count: 1,
            scissor_x: 0,
            scissor_y: 0,
            scissor_w: 100,
            scissor_h: 100,
            reserved: 0,
        };
        let mut clipped = base;
        clipped.scissor_w = 50;
        assert_ne!(
            draw_hash(&[base], &[], &[]),
            draw_hash(&[clipped], &[], &[])
        );
    }

    #[test]
    fn signed_zero_canonicalizes_in_rect_hash() {
        let pos = RectInstance {
            pos: [0.0, 1.0],
            size: [2.0, 3.0],
            tint: [1.0, 1.0, 1.0],
            alpha: 1.0,
        };
        let neg_zero = RectInstance {
            pos: [-0.0, 1.0],
            size: [2.0, 3.0],
            tint: [1.0, 1.0, 1.0],
            alpha: 1.0,
        };
        assert_eq!(
            draw_hash(&[], &[pos], &[]),
            draw_hash(&[], &[neg_zero], &[])
        );
    }

    #[test]
    fn tiny_fixture_hash_is_deterministic() {
        let cmd = DrawCmd {
            program: 0,
            instance_offset: 0,
            instance_count: 1,
            scissor_x: 1,
            scissor_y: 2,
            scissor_w: 3,
            scissor_h: 4,
            reserved: 0,
        };
        let rect = RectInstance {
            pos: [10.0, 20.0],
            size: [30.0, 40.0],
            tint: [0.1, 0.2, 0.3],
            alpha: 0.5,
        };
        let glyph = GlyphInstance {
            pos: [1.0, 2.0],
            size: [3.0, 4.0],
            uv_rect: [0.0, 0.0, 1.0, 1.0],
            tint: [1.0, 1.0, 1.0],
            alpha: 1.0,
        };
        let a = draw_state_hash(&[cmd], &[rect], &[glyph]);
        let b = draw_state_hash(&[cmd], &[rect], &[glyph]);
        assert_eq!(a, b);
        assert!(a.starts_with("fnv1a64:"));
        assert_eq!(a.len(), "fnv1a64:".len() + 16);
    }
}
