use serde::{Deserialize, Serialize};

#[repr(u16)]
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq, Serialize, Deserialize)]
pub enum KeyCode {
    Unknown = 0,
    Enter = 1,
    Escape = 2,
    Space = 3,
    Backspace = 4,
    Delete = 5,
    ArrowLeft = 6,
    ArrowRight = 7,
    Home = 8,
    End = 9,
    Slash = 10,
    KeyI = 11,
    KeyJ = 12,
    KeyK = 13,
    KeyL = 14,
    KeyQ = 15,
    KeyE = 16,
    KeyS = 17,
    KeyD = 18,
    KeyF = 19,
    KeyT = 20,
}

impl KeyCode {
    pub const fn as_u16(self) -> u16 {
        self as u16
    }

    pub const fn from_u16(value: u16) -> Self {
        match value {
            1 => Self::Enter,
            2 => Self::Escape,
            3 => Self::Space,
            4 => Self::Backspace,
            5 => Self::Delete,
            6 => Self::ArrowLeft,
            7 => Self::ArrowRight,
            8 => Self::Home,
            9 => Self::End,
            10 => Self::Slash,
            11 => Self::KeyI,
            12 => Self::KeyJ,
            13 => Self::KeyK,
            14 => Self::KeyL,
            15 => Self::KeyQ,
            16 => Self::KeyE,
            17 => Self::KeyS,
            18 => Self::KeyD,
            19 => Self::KeyF,
            20 => Self::KeyT,
            _ => Self::Unknown,
        }
    }
}
