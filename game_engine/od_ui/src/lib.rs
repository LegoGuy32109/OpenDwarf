#![warn(clippy::pedantic)]
#![allow(clippy::module_name_repetitions)]

pub mod domain;
pub mod draw;
pub mod chat;
pub mod focus;
pub mod font;
pub mod id;
pub mod input;
pub mod layout;
pub mod phase0;
pub mod primitives;
pub mod retained;
pub mod router;
pub mod settings;
pub mod shell;
pub mod text;
pub mod theme;
pub mod ui;
pub mod widgets;

pub use domain::{Engine as DomainEngine, FrameOut, SessionDomain, ShellDomain};
pub use draw::FrameOutput;
pub use focus::{Dir, Focus, UiIntent};
pub use font::{FontMetrics, Glyph, MonospaceVga};
pub use id::Id;
pub use layout::{Align, Alignment, Axis, Layout, Sizing};
pub use primitives::{Color, Padding, Rect, Vec2};
pub use retained::{Retained, RetainedEntry};
pub use router::{HostEffect, RoutedInput};
pub use settings::Settings;
pub use shell::{SettingChange, ShellIntent, ShellNav, ShellPage};
pub use text::{FontLine, FontLineGlyph, TextLayout, TextRun};
pub use theme::{Style, TextAlign, TextStyle, Theme};
pub use ui::{Response, Ui, UiEngine};
