use serde::{Deserialize, Serialize};

#[repr(u16)]
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq, Serialize, Deserialize)]
pub enum KeyCode {
    Unknown = 0,
    Enter = 1,
    Escape = 2,
    Space = 3,
    KeyI = 4,
    KeyJ = 5,
    KeyK = 6,
    KeyL = 7,
    KeyQ = 8,
    KeyE = 9,
    KeyS = 10,
    KeyD = 11,
    KeyF = 12,
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
            4 => Self::KeyI,
            5 => Self::KeyJ,
            6 => Self::KeyK,
            7 => Self::KeyL,
            8 => Self::KeyQ,
            9 => Self::KeyE,
            10 => Self::KeyS,
            11 => Self::KeyD,
            12 => Self::KeyF,
            _ => Self::Unknown,
        }
    }
}
