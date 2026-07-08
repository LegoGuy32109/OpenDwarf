use od_core::{EventKind, KeyCode, SessionIntent, TextEdit};

use crate::{
    FontMetrics,
    focus::UiIntent,
};

use super::decode::{DecodedInput, decode};
use super::held::{HeldSet, RepeatState};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum InputMode {
    Gameplay,
    TextField,
}

#[derive(Clone, Debug, Default)]
pub struct KeymapFrameOut {
    pub ui_intents: Vec<UiIntent>,
    pub session_intents: Vec<SessionIntent>,
}

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

    pub fn clear_repeats(&mut self) {
        self.repeats.clear();
    }

    pub fn frame<M: FontMetrics>(
        &mut self,
        decoded: &DecodedInput<'_>,
        mode: InputMode,
        font: &M,
    ) -> KeymapFrameOut {
        let mut out = KeymapFrameOut::default();
        if decoded.sampled.window_focused == 0 {
            self.clear();
            return out;
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
                        match mode {
                            InputMode::Gameplay => {
                                if let Some(binding) = gameplay_binding_for(code) {
                                    match binding {
                                        Binding::Once(intent) => out.ui_intents.push(intent),
                                        Binding::Repeat(intent) => {
                                            out.ui_intents.push(intent);
                                            self.repeats.arm(code);
                                        }
                                    }
                                }
                            }
                            InputMode::TextField => {
                                if let Some(intent) = text_binding_for(code, event.modifiers) {
                                    out.session_intents.push(intent);
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
                EventKind::Text => {
                    if matches!(mode, InputMode::TextField)
                        && let Some(ch) = char::from_u32(event.value)
                        && font.accepts_text_char(ch)
                    {
                        out.session_intents
                            .push(SessionIntent::EditChat(TextEdit::InsertText(ch)));
                    }
                }
                EventKind::Blur | EventKind::Resync => {
                    self.clear();
                }
                EventKind::Composition | EventKind::Unknown => {}
            }
        }

        if matches!(mode, InputMode::Gameplay) {
            for code in self.repeats.advance(decoded.sampled.dt_ms, &self.held) {
                if let Some(Binding::Repeat(intent)) = gameplay_binding_for(code) {
                    out.ui_intents.push(intent);
                }
            }
        }

        out
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum Binding {
    Once(UiIntent),
    Repeat(UiIntent),
}

fn gameplay_binding_for(code: KeyCode) -> Option<Binding> {
    match code {
        KeyCode::KeyI => Some(Binding::Repeat(UiIntent::FocusPrev)),
        KeyCode::KeyK => Some(Binding::Repeat(UiIntent::FocusNext)),
        KeyCode::Enter | KeyCode::Space => Some(Binding::Once(UiIntent::Activate)),
        KeyCode::KeyQ => Some(Binding::Once(UiIntent::Cancel)),
        KeyCode::KeyT => None,
        KeyCode::Slash => None,
        _ => None,
    }
}

fn text_binding_for(code: KeyCode, modifiers: u8) -> Option<SessionIntent> {
    match code {
        KeyCode::Backspace => {
            if modifiers & od_core::INPUT_MODIFIER_CTRL != 0 {
                Some(SessionIntent::EditChat(TextEdit::DeleteWordBack))
            } else {
                Some(SessionIntent::EditChat(TextEdit::DeleteBack))
            }
        }
        KeyCode::Delete => Some(SessionIntent::EditChat(TextEdit::DeleteFwd)),
        KeyCode::ArrowLeft => Some(SessionIntent::EditChat(TextEdit::CaretLeft)),
        KeyCode::ArrowRight => Some(SessionIntent::EditChat(TextEdit::CaretRight)),
        KeyCode::Home => Some(SessionIntent::EditChat(TextEdit::CaretHome)),
        KeyCode::End => Some(SessionIntent::EditChat(TextEdit::CaretEnd)),
        KeyCode::Enter => Some(SessionIntent::SubmitChat),
        _ => None,
    }
}

pub fn frame<M: FontMetrics>(
    state: &mut InputState,
    bytes: &[u8],
    mode: InputMode,
    font: &M,
) -> KeymapFrameOut {
    let Some(decoded) = decode(bytes) else {
        return KeymapFrameOut::default();
    };
    state.frame(&decoded, mode, font)
}

#[cfg(test)]
mod tests {
    use crate::input::decode_arena;

    use od_core::{
        INPUT_KIND_BLUR, INPUT_KIND_KEY_DOWN, INPUT_KIND_TEXT, InputArena, InputEvent,
        InputQueueHeader, InputSampled, KeyCode,
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
    fn gameplay_keydown_emits_repeatable_and_once_intents() {
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
        let out = state.frame(&decoded, InputMode::Gameplay, &crate::font::MonospaceVga);
        assert_eq!(out.ui_intents, vec![UiIntent::FocusPrev, UiIntent::Activate]);
    }

    #[test]
    fn textfield_keydown_emits_editing_intents() {
        let events = [
            InputEvent {
                kind: INPUT_KIND_KEY_DOWN,
                modifiers: od_core::INPUT_MODIFIER_CTRL,
                code: KeyCode::Backspace as u16,
                value: 0,
            },
            InputEvent {
                kind: INPUT_KIND_TEXT,
                modifiers: 0,
                code: 0,
                value: 'a' as u32,
            },
        ];
        let arena = arena_with_events(&events, 16.0);
        let mut state = InputState::default();
        let decoded = decode_arena(&arena);
        let out = state.frame(&decoded, InputMode::TextField, &crate::font::MonospaceVga);
        assert_eq!(
            out.session_intents,
            vec![
                SessionIntent::EditChat(TextEdit::DeleteWordBack),
                SessionIntent::EditChat(TextEdit::InsertText('a')),
            ]
        );
    }

    #[test]
    fn held_keys_repeat_in_gameplay() {
        let mut state = InputState::default();
        let arena = arena_with_events(
            &[InputEvent {
                kind: INPUT_KIND_KEY_DOWN,
                modifiers: 0,
                code: KeyCode::KeyK as u16,
                value: 0,
            }],
            16.0,
        );
        let decoded = decode_arena(&arena);
        let _ = state.frame(&decoded, InputMode::Gameplay, &crate::font::MonospaceVga);

        let mut next = InputArena::default();
        next.sampled.window_focused = 1;
        next.sampled.dt_ms = 400.0;
        let decoded = decode_arena(&next);
        let out = state.frame(&decoded, InputMode::Gameplay, &crate::font::MonospaceVga);
        assert_eq!(out.ui_intents, vec![UiIntent::FocusNext]);
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
        let out = state.frame(&decoded, InputMode::Gameplay, &crate::font::MonospaceVga);
        assert_eq!(out.ui_intents, vec![UiIntent::FocusPrev]);

        let mut next = InputArena::default();
        next.sampled.window_focused = 1;
        next.sampled.dt_ms = 16.0;
        let decoded = decode_arena(&next);
        let out = state.frame(&decoded, InputMode::Gameplay, &crate::font::MonospaceVga);
        assert!(out.ui_intents.is_empty());
    }
}
