use crate::primitives::{Color, Padding};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum TextAlign {
    Left,
    Center,
    Right,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct TextStyle {
    pub px: Option<f32>,
    pub color: Option<Color>,
    pub align: TextAlign,
    pub wrap: bool,
}

impl Default for TextStyle {
    fn default() -> Self {
        Self {
            px: None,
            color: None,
            align: TextAlign::Left,
            wrap: true,
        }
    }
}

impl TextStyle {
    pub const fn new() -> Self {
        Self {
            px: None,
            color: None,
            align: TextAlign::Left,
            wrap: true,
        }
    }

    pub fn px(mut self, px: f32) -> Self {
        self.px = Some(px);
        self
    }

    pub fn color(mut self, color: Color) -> Self {
        self.color = Some(color);
        self
    }

    pub fn align(mut self, align: TextAlign) -> Self {
        self.align = align;
        self
    }

    pub fn wrap(mut self, wrap: bool) -> Self {
        self.wrap = wrap;
        self
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Style {
    pub bg: Option<Color>,
    pub border: Option<Color>,
    pub border_px: Option<f32>,
    pub pad: Option<Padding>,
    pub gap: Option<f32>,
}

impl Default for Style {
    fn default() -> Self {
        Self {
            bg: None,
            border: None,
            border_px: None,
            pad: None,
            gap: None,
        }
    }
}

impl Style {
    pub const fn new() -> Self {
        Self {
            bg: None,
            border: None,
            border_px: None,
            pad: None,
            gap: None,
        }
    }

    pub fn bg(mut self, color: Color) -> Self {
        self.bg = Some(color);
        self
    }

    pub fn border(mut self, color: Color) -> Self {
        self.border = Some(color);
        self
    }

    pub fn border_px(mut self, border_px: f32) -> Self {
        self.border_px = Some(border_px);
        self
    }

    pub fn border_with(mut self, color: Color, border_px: f32) -> Self {
        self.border = Some(color);
        self.border_px = Some(border_px);
        self
    }

    pub fn pad(mut self, pad: Padding) -> Self {
        self.pad = Some(pad);
        self
    }

    pub fn gap(mut self, gap: f32) -> Self {
        self.gap = Some(gap);
        self
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Theme {
    pub panel_bg: Color,
    pub scrim: Color,
    pub border: Color,
    pub text: Color,
    pub text_disabled: Color,
    pub focus_ring: Color,
    pub focus_bg: Color,
    pub pad: Padding,
    pub gap: f32,
    pub font_px: f32,
}

impl Theme {
    pub const fn dwarf_dark() -> Self {
        Self {
            panel_bg: Color::rgb(26, 28, 32),
            scrim: Color::rgba(0, 0, 0, 128),
            border: Color::rgb(154, 124, 77),
            text: Color::rgb(243, 231, 201),
            text_disabled: Color::rgb(130, 124, 111),
            focus_ring: Color::rgb(229, 182, 92),
            focus_bg: Color::rgb(51, 61, 74),
            pad: Padding {
                top: 8.0,
                right: 8.0,
                bottom: 8.0,
                left: 8.0,
            },
            gap: 4.0,
            font_px: 16.0,
        }
    }
}

impl Default for Theme {
    fn default() -> Self {
        Self::dwarf_dark()
    }
}

#[derive(Clone, Copy, Debug)]
pub(crate) struct ResolvedStyle {
    pub(crate) bg: Color,
    pub(crate) border: Color,
    pub(crate) border_px: f32,
}

impl ResolvedStyle {
    pub(crate) fn from_style(style: Style, theme: Theme) -> Self {
        Self {
            bg: style.bg.unwrap_or(theme.panel_bg),
            border: style.border.unwrap_or(theme.border),
            border_px: style.border_px.unwrap_or(1.0),
        }
    }
}
