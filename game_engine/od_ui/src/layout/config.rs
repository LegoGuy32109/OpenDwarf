use crate::{focus::Focus, primitives::Padding};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Axis {
    Row,
    Column,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Alignment {
    Start,
    Center,
    End,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct Align {
    pub main: Alignment,
    pub cross: Alignment,
}

impl Default for Align {
    fn default() -> Self {
        Self {
            main: Alignment::Start,
            cross: Alignment::Start,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Sizing {
    Fit { min: f32, max: f32 },
    Grow { min: f32, max: f32 },
    Fixed(f32),
    Percent(f32),
}

impl Sizing {
    pub const fn fit() -> Self {
        Self::Fit {
            min: 0.0,
            max: f32::INFINITY,
        }
    }

    pub const fn grow() -> Self {
        Self::Grow {
            min: 0.0,
            max: f32::INFINITY,
        }
    }

    pub const fn fixed(px: f32) -> Self {
        Self::Fixed(px)
    }

    pub const fn percent(fraction: f32) -> Self {
        Self::Percent(fraction)
    }

    pub const fn bounds(self) -> (f32, f32) {
        match self {
            Self::Fit { min, max } | Self::Grow { min, max } => (min, max),
            Self::Fixed(value) => (value, value),
            Self::Percent(_) => (0.0, f32::INFINITY),
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Layout {
    pub direction: Axis,
    pub sizing: [Sizing; 2],
    pub padding: Padding,
    pub gap: f32,
    pub align: Align,
    pub focus: Focus,
}

impl Default for Layout {
    fn default() -> Self {
        Self::new()
    }
}

impl Layout {
    pub const fn new() -> Self {
        Self {
            direction: Axis::Column,
            sizing: [Sizing::fit(), Sizing::fit()],
            padding: Padding {
                top: 0.0,
                right: 0.0,
                bottom: 0.0,
                left: 0.0,
            },
            gap: 0.0,
            align: Align {
                main: Alignment::Start,
                cross: Alignment::Start,
            },
            focus: Focus::Linear,
        }
    }

    pub fn row(mut self) -> Self {
        self.direction = Axis::Row;
        self
    }

    pub fn column(mut self) -> Self {
        self.direction = Axis::Column;
        self
    }

    pub fn grid(mut self, cols: u32) -> Self {
        self.direction = Axis::Row;
        self.focus = Focus::Grid { cols };
        self
    }

    pub fn pad(mut self, pad: Padding) -> Self {
        self.padding = pad;
        self
    }

    pub fn gap(mut self, gap: f32) -> Self {
        self.gap = gap;
        self
    }

    pub fn align(mut self, main: Alignment, cross: Alignment) -> Self {
        self.align = Align { main, cross };
        self
    }

    pub fn sizing(mut self, axis: Axis, sizing: Sizing) -> Self {
        self.sizing[axis_index(axis)] = sizing;
        self
    }

    pub fn fixed(mut self, width: f32, height: f32) -> Self {
        self.sizing = [Sizing::fixed(width), Sizing::fixed(height)];
        self
    }

    pub fn percent(mut self, width: f32, height: f32) -> Self {
        self.sizing = [Sizing::percent(width), Sizing::percent(height)];
        self
    }

    pub fn grow(mut self) -> Self {
        self.sizing = [Sizing::grow(), Sizing::grow()];
        self
    }
}

fn axis_index(axis: Axis) -> usize {
    match axis {
        Axis::Row => 0,
        Axis::Column => 1,
    }
}
