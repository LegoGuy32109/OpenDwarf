use od_core::{DRAWCMD_PROGRAM_RECT, DRAWCMD_PROGRAM_TEXT, DrawCmd, GlyphInstance, RectInstance};

use crate::{
    font::FontMetrics,
    primitives::EPS,
    text::{TextRun, text_color, text_px},
    theme::{ResolvedStyle, TextAlign, TextStyle},
    ui::{ContainerKind, FrameBuild, NodeKind},
};

pub struct FrameOutput {
    pub rects: Vec<RectInstance>,
    pub glyphs: Vec<GlyphInstance>,
    pub draw_cmds: Vec<DrawCmd>,
    pub responses: Vec<crate::ui::Response>,
}

impl FrameOutput {
    pub fn draw_list_count(&self) -> u32 {
        self.draw_cmds.len() as u32
    }
}

impl<M: FontMetrics> FrameBuild<M> {
    pub(crate) fn emit_node(&mut self, index: usize) {
        match self.nodes[index].kind.clone() {
            NodeKind::Container {
                kind: ContainerKind::Flow,
                style,
            } => {
                if let Some(style) = style {
                    self.emit_rects_for_style(index, ResolvedStyle::from_style(style, self.theme));
                }
                for child in self.nodes[index].children.clone() {
                    self.emit_node(child);
                }
            }
            NodeKind::Container {
                kind: ContainerKind::Panel,
                style,
            } => {
                if let Some(style) = style {
                    self.emit_rects_for_style(index, ResolvedStyle::from_style(style, self.theme));
                } else {
                    self.emit_rects_for_style(
                        index,
                        ResolvedStyle::from_style(crate::theme::Style::default(), self.theme),
                    );
                }
                for child in self.nodes[index].children.clone() {
                    self.emit_node(child);
                }
            }
            NodeKind::Spacer => {}
            NodeKind::Text { runs, cfg } => {
                self.emit_text(index, &runs, &cfg, false);
            }
            NodeKind::Button { label, cfg } => {
                let focused = self.focus == Some(self.nodes[index].id);
                let style = if focused {
                    ResolvedStyle {
                        bg: self.theme.focus_bg,
                        border: self.theme.focus_ring,
                        border_px: 1.0,
                    }
                } else {
                    ResolvedStyle {
                        bg: self.theme.panel_bg,
                        border: self.theme.border,
                        border_px: 1.0,
                    }
                };
                self.emit_rects_for_style(index, style);
                self.emit_text(
                    index,
                    &[TextRun {
                        text: label,
                        color: text_color(&cfg, self.theme),
                    }],
                    &cfg.align(TextAlign::Center).wrap(false),
                    true,
                );
            }
        }
    }

    pub(crate) fn emit_rects_for_style(&mut self, index: usize, style: ResolvedStyle) {
        let rect = self.nodes[index].pos_to_rect();
        let border = style.border_px.max(0.0);
        let has_border = border > EPS;
        let bg = RectInstance {
            pos: [rect.x.round(), rect.y.round()],
            size: [rect.w.round(), rect.h.round()],
            tint: [
                f32::from(style.bg.r) / 255.0,
                f32::from(style.bg.g) / 255.0,
                f32::from(style.bg.b) / 255.0,
            ],
            alpha: f32::from(style.bg.a) / 255.0,
        };
        let start_rect_count = self.rects.len();
        self.rects.push(bg);
        if has_border {
            let border_color = [
                f32::from(style.border.r) / 255.0,
                f32::from(style.border.g) / 255.0,
                f32::from(style.border.b) / 255.0,
            ];
            let alpha = f32::from(style.border.a) / 255.0;
            let top = RectInstance {
                pos: [rect.x.round(), rect.y.round()],
                size: [rect.w.round(), border.round()],
                tint: border_color,
                alpha,
            };
            let bottom = RectInstance {
                pos: [rect.x.round(), (rect.bottom() - border).round()],
                size: [rect.w.round(), border.round()],
                tint: border_color,
                alpha,
            };
            let left = RectInstance {
                pos: [rect.x.round(), rect.y.round()],
                size: [border.round(), rect.h.round()],
                tint: border_color,
                alpha,
            };
            let right = RectInstance {
                pos: [(rect.right() - border).round(), rect.y.round()],
                size: [border.round(), rect.h.round()],
                tint: border_color,
                alpha,
            };
            self.rects.extend([top, bottom, left, right]);
        }
        let rect_count = self.rects.len() - start_rect_count;
        self.draw_cmds.push(DrawCmd {
            program: DRAWCMD_PROGRAM_RECT,
            instance_offset: start_rect_count as u32,
            instance_count: rect_count as u32,
            scissor_x: -1,
            scissor_y: -1,
            scissor_w: -1,
            scissor_h: -1,
            reserved: 0,
        });
    }

    pub(crate) fn emit_text(
        &mut self,
        index: usize,
        _runs: &[TextRun],
        cfg: &TextStyle,
        center: bool,
    ) {
        let Some(layout) = self.nodes[index].text_layout.clone() else {
            return;
        };
        let px = text_px(cfg, self.theme, self.scale);
        let rect = self.nodes[index].pos_to_rect();
        let inner_width = if center {
            rect.w
        } else {
            (rect.w - self.nodes[index].layout.padding.horizontal()).max(0.0)
        };
        let start_x = if center {
            rect.x
        } else {
            rect.x + self.nodes[index].layout.padding.left
        };
        let start_y = if center {
            rect.y + (rect.h - layout.height()).max(0.0) * 0.5
        } else {
            rect.y + self.nodes[index].layout.padding.top
        };
        let start_glyph = self.glyphs.len();
        for (line_index, line) in layout.lines.iter().enumerate() {
            let align_offset = match cfg.align {
                TextAlign::Left => 0.0,
                TextAlign::Center => (inner_width - line.width).max(0.0) * 0.5,
                TextAlign::Right => (inner_width - line.width).max(0.0),
            };
            let line_y = start_y + line_index as f32 * layout.line_height;
            for glyph in &line.glyphs {
                if let Some(meta) = self.font().glyph(glyph.ch, px) {
                    self.glyphs.push(GlyphInstance {
                        pos: [
                            (start_x + align_offset + glyph.x_offset).round(),
                            line_y.round(),
                        ],
                        size: [meta.size.x.round(), meta.size.y.round()],
                        uv_rect: meta.uv,
                        tint: [
                            f32::from(glyph.color.r) / 255.0,
                            f32::from(glyph.color.g) / 255.0,
                            f32::from(glyph.color.b) / 255.0,
                        ],
                        alpha: f32::from(glyph.color.a) / 255.0,
                    });
                }
            }
        }
        let glyph_count = self.glyphs.len() - start_glyph;
        self.draw_cmds.push(DrawCmd {
            program: DRAWCMD_PROGRAM_TEXT,
            instance_offset: start_glyph as u32,
            instance_count: glyph_count as u32,
            scissor_x: -1,
            scissor_y: -1,
            scissor_w: -1,
            scissor_h: -1,
            reserved: 0,
        });
    }
}
