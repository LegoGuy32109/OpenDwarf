use crate::primitives::Vec2;

mod vga;

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Glyph {
    pub uv: [f32; 4],
    pub size: Vec2,
    pub advance: f32,
}

pub trait FontMetrics {
    fn line_height(&self, px: f32) -> f32;

    fn ascent(&self, px: f32) -> f32;

    fn descent(&self, px: f32) -> f32;

    fn advance(&self, ch: char, px: f32) -> f32;

    fn has_glyph(&self, ch: char) -> bool;

    fn measure_line(&self, s: &str, px: f32) -> Vec2 {
        let w = s.chars().map(|ch| self.advance(ch, px)).sum();
        Vec2::new(w, self.line_height(px))
    }

    fn glyph(&self, ch: char, px: f32) -> Option<Glyph>;
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub struct MonospaceVga;
