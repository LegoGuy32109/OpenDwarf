use crate::SettingChange;

pub const SETTINGS_VERSION: u8 = 1;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct Settings {
    pub version: u8,
    pub ui_scale: u8,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            version: SETTINGS_VERSION,
            ui_scale: 1,
        }
    }
}

impl Settings {
    pub fn clamp_ui_scale(value: u8) -> u8 {
        value.clamp(1, 4)
    }

    pub fn apply_change(&mut self, change: SettingChange) -> bool {
        match change {
            SettingChange::UiScale(value) => {
                let next = Self::clamp_ui_scale(value);
                let changed = self.ui_scale != next;
                self.ui_scale = next;
                changed
            }
        }
    }

    pub fn effective_scale(self, dpr: f32) -> f32 {
        dpr.max(1.0) * f32::from(self.ui_scale.max(1))
    }

    pub fn encode(self) -> Vec<u8> {
        vec![self.version, Self::clamp_ui_scale(self.ui_scale)]
    }

    pub fn decode(bytes: &[u8]) -> Option<Self> {
        if bytes.is_empty() {
            return Some(Self::default());
        }
        if bytes.len() < 2 || bytes[0] != SETTINGS_VERSION {
            return None;
        }
        Some(Self {
            version: bytes[0],
            ui_scale: Self::clamp_ui_scale(bytes[1]),
        })
    }
}
