use od_core::{EventKind, KeyCode};

use crate::focus::{Dir, Focus, UiIntent};

use super::decode::{decode, DecodedInput};
use super::held::{HeldSet, RepeatState};

#[derive(Debug, Default)]
pub struct InputState {
    held: HeldSet,
    repeats: RepeatState,
}

impl InputState {
    pub fn clear(&mut self) {
        self.held.clear();
        self.repeats.clear();
    }

    pub fn frame(&mut self, decoded: &DecodedInput<'_>, focus: Focus) -> Vec<UiIntent> {
        let mut intents = Vec::new();
        if decoded.sampled.window_focused == 0 {
            self.clear();
            return intents;
        }
        if decoded.queue.overflow != 0 {
            self.clear();
        }

        for event in decoded.events {
            match EventKind::from_u8(event.kind) {
                EventKind::KeyDown => {
                    let code = KeyCode::from_u16(event.code);
                    if code == KeyCode::Unknown {
                        continue;
                    }
                    if self.held.insert(code) {
                        if let Some(binding) = binding_for(code, focus) {
                            match binding {
                                Binding::Once(intent) => intents.push(intent),
                                Binding::Repeat(intent) => {
                                    intents.push(intent);
                                    self.repeats.arm(code);
                                }
                            }
                        }
                    }
                }
                EventKind::KeyUp => {
                    let code = KeyCode::from_u16(event.code);
                    if code != KeyCode::Unknown {
                        self.held.remove(code);
                        self.repeats.disarm(code);
                    }
                }
                EventKind::Blur | EventKind::Resync => {
                    self.clear();
                }
                EventKind::Unknown => {}
            }
        }

        for code in self.repeats.advance(decoded.sampled.dt_ms, &self.held) {
            if let Some(Binding::Repeat(intent)) = binding_for(code, focus) {
                intents.push(intent);
            }
        }

        intents
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum Binding {
    Once(UiIntent),
    Repeat(UiIntent),
}

fn binding_for(code: KeyCode, focus: Focus) -> Option<Binding> {
    match focus {
        Focus::Linear => match code {
            KeyCode::KeyI => Some(Binding::Repeat(UiIntent::FocusPrev)),
            KeyCode::KeyK => Some(Binding::Repeat(UiIntent::FocusNext)),
            KeyCode::Enter | KeyCode::Space => Some(Binding::Once(UiIntent::Activate)),
            KeyCode::Escape | KeyCode::KeyQ => Some(Binding::Once(UiIntent::Cancel)),
            _ => None,
        },
        Focus::Grid { .. } => match code {
            KeyCode::KeyI => Some(Binding::Repeat(UiIntent::GridMove(Dir::Up))),
            KeyCode::KeyJ => Some(Binding::Repeat(UiIntent::GridMove(Dir::Left))),
            KeyCode::KeyK => Some(Binding::Repeat(UiIntent::GridMove(Dir::Down))),
            KeyCode::KeyL => Some(Binding::Repeat(UiIntent::GridMove(Dir::Right))),
            KeyCode::Enter | KeyCode::Space => Some(Binding::Once(UiIntent::Activate)),
            KeyCode::Escape | KeyCode::KeyQ => Some(Binding::Once(UiIntent::Cancel)),
            _ => None,
        },
    }
}

pub fn frame(state: &mut InputState, bytes: &[u8], focus: Focus) -> Vec<UiIntent> {
    let Some(decoded) = decode(bytes) else {
        return Vec::new();
    };
    state.frame(&decoded, focus)
}

#[cfg(test)]
mod tests {
    use bytemuck::bytes_of;
    use crate::input::decode_arena;

    use od_core::{
        EventKind, InputArena, InputEvent, InputQueueHeader, InputSampled, KeyCode,
        INPUT_KIND_BLUR, INPUT_KIND_KEY_DOWN, INPUT_KIND_KEY_UP,
    };

    use super::*;

    fn arena_with_events(events: &[InputEvent], dt_ms: f32) -> InputArena {
        let mut arena = InputArena::default();
        arena.sampled = InputSampled {
            framebuffer_w: 800,
            framebuffer_h: 600,
            dpr: 1.0,
            dt_ms,
            window_focused: 1,
            pointer_x: 0.0,
            pointer_y: 0.0,
            buttons: 0,
        };
        arena.queue = InputQueueHeader {
            count: events.len() as u32,
            overflow: 0,
        };
        for (index, event) in events.iter().copied().enumerate() {
            arena.events[index] = event;
        }
        arena
    }

    #[test]
    fn linear_keydown_emits_repeatable_and_once_intents() {
        let events = [
            InputEvent {
                kind: INPUT_KIND_KEY_DOWN,
                modifiers: 0,
                code: KeyCode::KeyI as u16,
                value: 0,
            },
            InputEvent {
                kind: INPUT_KIND_KEY_DOWN,
                modifiers: 0,
                code: KeyCode::Enter as u16,
                value: 0,
            },
        ];
        let arena = arena_with_events(&events, 16.0);
        let mut state = InputState::default();

        let decoded = decode_arena(&arena);
        let intents = state.frame(&decoded, Focus::Linear);
        assert_eq!(intents, vec![UiIntent::FocusPrev, UiIntent::Activate]);
    }

    #[test]
    fn held_keys_repeat_after_delay() {
        let mut state = InputState::default();
        let mut arena = arena_with_events(
            &[InputEvent {
                kind: INPUT_KIND_KEY_DOWN,
                modifiers: 0,
                code: KeyCode::KeyK as u16,
                value: 0,
            }],
            16.0,
        );
        let decoded = decode_arena(&arena);
        let _ = state.frame(&decoded, Focus::Linear);

        arena.sampled.dt_ms = 400.0;
        arena.queue = InputQueueHeader {
            count: 0,
            overflow: 0,
        };
        let decoded = decode_arena(&arena);
        let intents = state.frame(&decoded, Focus::Linear);
        assert_eq!(intents, vec![UiIntent::FocusNext]);
    }

    #[test]
    fn blur_clears_held_state() {
        let mut state = InputState::default();
        let events = [
            InputEvent {
                kind: INPUT_KIND_KEY_DOWN,
                modifiers: 0,
                code: KeyCode::KeyI as u16,
                value: 0,
            },
            InputEvent {
                kind: INPUT_KIND_BLUR,
                modifiers: 0,
                code: 0,
                value: 0,
            },
        ];
        let arena = arena_with_events(&events, 16.0);
        let decoded = decode_arena(&arena);
        let intents = state.frame(&decoded, Focus::Linear);
        assert_eq!(intents, vec![UiIntent::FocusPrev]);

        let mut next_arena = InputArena::default();
        next_arena.sampled.window_focused = 1;
        next_arena.sampled.dt_ms = 16.0;
        let decoded = decode_arena(&next_arena);
        let intents = state.frame(&decoded, Focus::Linear);
        assert!(intents.is_empty());
    }

    #[test]
    fn overflow_clears_held_state() {
        let mut state = InputState::default();
        let pressed = arena_with_events(
            &[InputEvent {
                kind: INPUT_KIND_KEY_DOWN,
                modifiers: 0,
                code: KeyCode::KeyI as u16,
                value: 0,
            }],
            16.0,
        );
        let decoded = decode_arena(&pressed);
        let _ = state.frame(&decoded, Focus::Linear);

        let mut overflow = InputArena::default();
        overflow.sampled.window_focused = 1;
        overflow.sampled.dt_ms = 16.0;
        overflow.queue = InputQueueHeader {
            count: 0,
            overflow: 1,
        };
        let decoded = decode_arena(&overflow);
        let intents = state.frame(&decoded, Focus::Linear);
        assert!(intents.is_empty());
    }

    #[test]
    fn decode_and_frame_round_trip() {
        let arena = arena_with_events(
            &[InputEvent {
                kind: INPUT_KIND_KEY_UP,
                modifiers: 0,
                code: KeyCode::KeyQ as u16,
                value: 0,
            }],
            16.0,
        );
        let bytes = bytes_of(&arena);
        let mut state = InputState::default();
        let intents = frame(&mut state, bytes, Focus::Linear);
        assert!(intents.is_empty());
        assert_eq!(EventKind::from_u8(INPUT_KIND_KEY_UP), EventKind::KeyUp);
    }
}
