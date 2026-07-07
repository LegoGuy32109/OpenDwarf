pub mod field;
pub mod state;

use crate::{
    FontMetrics,
    primitives::{Color, EPS},
    theme::{TextStyle, Theme},
};

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TextRun {
    pub text: String,
    pub color: Color,
}

#[derive(Clone, Copy, Debug)]
pub struct FontLineGlyph {
    pub ch: char,
    pub color: Color,
    pub x_offset: f32,
}

#[derive(Clone, Debug, Default)]
pub struct FontLine {
    pub glyphs: Vec<FontLineGlyph>,
    pub width: f32,
}

#[derive(Clone, Debug, Default)]
pub struct TextLayout {
    pub lines: Vec<FontLine>,
    pub line_height: f32,
}

impl TextLayout {
    pub fn height(&self) -> f32 {
        self.lines.len() as f32 * self.line_height
    }
}

fn line_tab_width(current_width: f32, tab_stop: f32) -> f32 {
    let remainder = current_width.rem_euclid(tab_stop);
    if remainder <= EPS {
        tab_stop
    } else {
        tab_stop - remainder
    }
}

pub(crate) fn text_color(cfg: &TextStyle, theme: Theme) -> Color {
    cfg.color.unwrap_or(theme.text)
}

pub(crate) fn text_px(cfg: &TextStyle, theme: Theme, scale: f32) -> f32 {
    cfg.px.unwrap_or(theme.font_px) * scale
}

pub(crate) fn text_fit_width<M: FontMetrics>(
    metrics: &M,
    runs: &[TextRun],
    px: f32,
    wrap: bool,
) -> f32 {
    if !wrap {
        let mut widest: f32 = 0.0;
        let mut current: f32 = 0.0;
        for run in runs {
            for ch in run.text.chars() {
                match ch {
                    '\n' => {
                        widest = widest.max(current);
                        current = 0.0;
                    }
                    '\t' => {
                        current += metrics.advance(' ', px) * 4.0;
                    }
                    _ => current += metrics.advance(ch, px),
                }
            }
        }
        widest.max(current)
    } else {
        let mut widest_word: f32 = 0.0;
        let mut current_word: f32 = 0.0;
        for run in runs {
            for ch in run.text.chars() {
                match ch {
                    ' ' | '\n' | '\t' => {
                        widest_word = widest_word.max(current_word);
                        current_word = 0.0;
                    }
                    _ => current_word += metrics.advance(ch, px),
                }
            }
        }
        widest_word.max(current_word)
    }
}

pub(crate) fn text_unwrapped_width<M: FontMetrics>(metrics: &M, runs: &[TextRun], px: f32) -> f32 {
    let mut widest: f32 = 0.0;
    let mut current: f32 = 0.0;
    for run in runs {
        for ch in run.text.chars() {
            match ch {
                '\n' => {
                    widest = widest.max(current);
                    current = 0.0;
                }
                '\t' => {
                    current += metrics.advance(' ', px) * 4.0;
                }
                _ => current += metrics.advance(ch, px),
            }
        }
    }
    widest.max(current)
}

pub(crate) fn layout_text<M: FontMetrics>(
    metrics: &M,
    runs: &[TextRun],
    cfg: &TextStyle,
    theme: Theme,
    scale: f32,
    box_width: f32,
) -> TextLayout {
    let px = text_px(cfg, theme, scale);
    let line_height = metrics.line_height(px);
    let mut lines: Vec<FontLine> = Vec::new();
    let mut current = FontLine::default();
    let mut pending_space = false;
    let mut word: Vec<(char, Color)> = Vec::new();
    let mut word_width = 0.0;
    let flush_word = |lines: &mut Vec<FontLine>,
                      current: &mut FontLine,
                      word: &mut Vec<(char, Color)>,
                      word_width: &mut f32,
                      pending_space: &mut bool| {
        if word.is_empty() {
            return;
        }

        let space_width = if *pending_space && !current.glyphs.is_empty() {
            metrics.advance(' ', px)
        } else {
            0.0
        };
        let wrap_width = box_width.max(0.0);
        let needs_wrap = wrap_width > EPS
            && !current.glyphs.is_empty()
            && current.width + space_width + *word_width > wrap_width + EPS;
        if needs_wrap {
            lines.push(std::mem::take(current));
        }
        if *pending_space && !current.glyphs.is_empty() {
            current.width += metrics.advance(' ', px);
        }
        *pending_space = false;

        let wrap_width = box_width.max(0.0);
        let hard_break =
            wrap_width > EPS && current.glyphs.is_empty() && *word_width > wrap_width + EPS;
        if hard_break {
            for (ch, color) in word.drain(..) {
                let glyph_width = metrics.advance(ch, px);
                if !current.glyphs.is_empty() && current.width + glyph_width > wrap_width + EPS {
                    lines.push(std::mem::take(current));
                }
                current.glyphs.push(FontLineGlyph {
                    ch,
                    color,
                    x_offset: current.width,
                });
                current.width += glyph_width;
            }
        } else {
            let mut x = current.width;
            for (ch, color) in word.drain(..) {
                current.glyphs.push(FontLineGlyph {
                    ch,
                    color,
                    x_offset: x,
                });
                let glyph_width = metrics.advance(ch, px);
                x += glyph_width;
                current.width = x;
            }
        }
        *word_width = 0.0;
    };

    for run in runs {
        for ch in run.text.chars() {
            match ch {
                '\n' => {
                    flush_word(
                        &mut lines,
                        &mut current,
                        &mut word,
                        &mut word_width,
                        &mut pending_space,
                    );
                    lines.push(std::mem::take(&mut current));
                    pending_space = false;
                }
                ' ' => {
                    flush_word(
                        &mut lines,
                        &mut current,
                        &mut word,
                        &mut word_width,
                        &mut pending_space,
                    );
                    pending_space = true;
                }
                '\t' => {
                    flush_word(
                        &mut lines,
                        &mut current,
                        &mut word,
                        &mut word_width,
                        &mut pending_space,
                    );
                    let tab_stop = metrics.advance(' ', px) * 4.0;
                    let tab_width = line_tab_width(current.width, tab_stop);
                    if box_width > EPS
                        && current.width > EPS
                        && current.width + tab_width > box_width + EPS
                    {
                        lines.push(std::mem::take(&mut current));
                        current.width = 0.0;
                    }
                    let tab_width = line_tab_width(current.width, tab_stop);
                    current.width += tab_width;
                }
                _ => {
                    let advance = metrics.advance(ch, px);
                    let wrap_width = box_width.max(0.0);
                    if wrap_width > EPS
                        && !current.glyphs.is_empty()
                        && current.width + word_width + advance > wrap_width + EPS
                        && !word.is_empty()
                    {
                        flush_word(
                            &mut lines,
                            &mut current,
                            &mut word,
                            &mut word_width,
                            &mut pending_space,
                        );
                        lines.push(std::mem::take(&mut current));
                    }
                    word.push((ch, text_color(cfg, theme)));
                    word_width += advance;
                }
            }
        }
    }

    flush_word(
        &mut lines,
        &mut current,
        &mut word,
        &mut word_width,
        &mut pending_space,
    );
    if !current.glyphs.is_empty() || current.width > EPS || lines.is_empty() {
        lines.push(current);
    }

    TextLayout { lines, line_height }
}
