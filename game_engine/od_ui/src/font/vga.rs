use crate::{
    FontMetrics, Glyph,
    primitives::{EPS, Vec2},
};

use super::MonospaceVga;

const VGA_FIRST_CHAR: u32 = 33;
const VGA_LAST_CHAR: u32 = 126;
const VGA_COLUMNS: u32 = 32;
const VGA_CELL_WIDTH: f32 = 8.0;
const VGA_CELL_HEIGHT: f32 = 16.0;

fn vga_scale(px: f32) -> f32 {
    (px / VGA_CELL_HEIGHT).round().max(1.0)
}

fn vga_glyph_uv(code: u32) -> [f32; 4] {
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

/// Monospace VGA bitmap metrics for crisp integer-scaled UI text.
///
/// The future MSDF path stays behind the `FontMetrics` trait so non-integer
/// scale and world-embedded text can swap in a different implementation without
/// touching the solver or widget code.
impl FontMetrics for MonospaceVga {
    fn line_height(&self, px: f32) -> f32 {
        VGA_CELL_HEIGHT * vga_scale(px)
    }

    fn ascent(&self, px: f32) -> f32 {
        self.line_height(px)
    }

    fn descent(&self, _px: f32) -> f32 {
        0.0
    }

    fn advance(&self, ch: char, px: f32) -> f32 {
        match ch {
            '\t' => self.advance(' ', px) * 4.0,
            _ => VGA_CELL_WIDTH * vga_scale(px),
        }
    }

    fn accepts_text_char(&self, ch: char) -> bool {
        match ch {
            ' ' => true,
            c if (VGA_FIRST_CHAR..=VGA_LAST_CHAR).contains(&(c as u32)) => true,
            _ => false,
        }
    }

    fn measure_line(&self, s: &str, px: f32) -> Vec2 {
        let mut width: f32 = 0.0;
        let tab_stop = self.advance(' ', px) * 4.0;
        for ch in s.chars() {
            match ch {
                '\t' => {
                    let remainder = width.rem_euclid(tab_stop);
                    width += if remainder.abs() <= EPS {
                        tab_stop
                    } else {
                        tab_stop - remainder
                    };
                }
                '\n' => break,
                _ => width += self.advance(ch, px),
            }
        }
        Vec2::new(width, self.line_height(px))
    }

    fn glyph(&self, ch: char, px: f32) -> Option<Glyph> {
        let scale = vga_scale(px);
        match ch {
            ' ' | '\t' | '\n' | '\r' => None,
            c if (VGA_FIRST_CHAR..=VGA_LAST_CHAR).contains(&(c as u32)) => Some(Glyph {
                uv: vga_glyph_uv(c as u32),
                size: Vec2::new(VGA_CELL_WIDTH * scale, VGA_CELL_HEIGHT * scale),
                advance: VGA_CELL_WIDTH * scale,
            }),
            _ => None,
        }
    }
}
