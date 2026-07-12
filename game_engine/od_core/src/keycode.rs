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
    KeyR = 21,
    KeyV = 22,
    KeyU = 23,
    KeyM = 24,
    Digit1 = 25,
    Digit2 = 26,
    Digit3 = 27,
    Digit4 = 28,
    Digit5 = 29,
    Digit6 = 30,
    Digit7 = 31,
    Digit8 = 32,
    Digit9 = 33,
    Digit0 = 34,
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
            21 => Self::KeyR,
            22 => Self::KeyV,
            23 => Self::KeyU,
            24 => Self::KeyM,
            25 => Self::Digit1,
            26 => Self::Digit2,
            27 => Self::Digit3,
            28 => Self::Digit4,
            29 => Self::Digit5,
            30 => Self::Digit6,
            31 => Self::Digit7,
            32 => Self::Digit8,
            33 => Self::Digit9,
            34 => Self::Digit0,
            _ => Self::Unknown,
        }
    }
}
