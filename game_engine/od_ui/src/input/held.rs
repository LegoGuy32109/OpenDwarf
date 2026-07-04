use std::collections::HashMap;

use od_core::KeyCode;

pub const REPEAT_DELAY_MS: f32 = 400.0;
pub const REPEAT_INTERVAL_MS: f32 = 60.0;

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub struct HeldSet {
    bits: u128,
}

impl HeldSet {
    pub fn insert(&mut self, code: KeyCode) -> bool {
        let bit = Self::bit(code);
        if self.bits & bit != 0 {
            return false;
        }
        self.bits |= bit;
        true
    }

    pub fn remove(&mut self, code: KeyCode) -> bool {
        let bit = Self::bit(code);
        let was_set = self.bits & bit != 0;
        self.bits &= !bit;
        was_set
    }

    pub fn clear(&mut self) {
        self.bits = 0;
    }

    pub fn is_held(&self, code: KeyCode) -> bool {
        self.bits & Self::bit(code) != 0
    }

    const fn bit(code: KeyCode) -> u128 {
        let index = code as u16;
        if index >= 128 { 0 } else { 1_u128 << index }
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct RepeatTimer {
    elapsed_ms: f32,
    repeated: bool,
}

impl RepeatTimer {
    pub fn clear(&mut self) {
        *self = Self::default();
    }

    pub fn advance(&mut self, dt_ms: f32) -> usize {
        self.elapsed_ms += dt_ms.max(0.0);
        let mut repeats = 0_usize;
        if !self.repeated && self.elapsed_ms >= REPEAT_DELAY_MS {
            self.elapsed_ms -= REPEAT_DELAY_MS;
            self.repeated = true;
            repeats += 1;
        }
        if self.repeated {
            while self.elapsed_ms >= REPEAT_INTERVAL_MS {
                self.elapsed_ms -= REPEAT_INTERVAL_MS;
                repeats += 1;
            }
        }
        repeats
    }
}

#[derive(Debug, Default)]
pub struct RepeatState {
    timers: HashMap<KeyCode, RepeatTimer>,
}

impl RepeatState {
    pub fn arm(&mut self, code: KeyCode) {
        self.timers.entry(code).or_default();
    }

    pub fn disarm(&mut self, code: KeyCode) {
        self.timers.remove(&code);
    }

    pub fn clear(&mut self) {
        self.timers.clear();
    }

    pub fn advance(&mut self, dt_ms: f32, held: &HeldSet) -> Vec<KeyCode> {
        let mut repeats = Vec::new();
        self.timers.retain(|code, timer| {
            if !held.is_held(*code) {
                return false;
            }
            for _ in 0..timer.advance(dt_ms) {
                repeats.push(*code);
            }
            true
        });
        repeats
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use od_core::KeyCode;

    #[test]
    fn repeat_timer_waits_then_repeats() {
        let mut timer = RepeatTimer::default();
        assert_eq!(timer.advance(399.0), 0);
        assert_eq!(timer.advance(1.0), 1);
        assert_eq!(timer.advance(60.0), 1);
    }

    #[test]
    fn held_set_tracks_state() {
        let mut held = HeldSet::default();
        assert!(held.insert(KeyCode::KeyI));
        assert!(!held.insert(KeyCode::KeyI));
        assert!(held.is_held(KeyCode::KeyI));
        assert!(held.remove(KeyCode::KeyI));
        assert!(!held.is_held(KeyCode::KeyI));
    }
}
