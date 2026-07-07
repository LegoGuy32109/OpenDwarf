use od_core::{EventKind, InputEvent, KeyCode, SessionIntent};

use crate::{ShellIntent, input::DecodedInput};

#[derive(Clone, Debug, Default)]
pub struct RoutedInput {
    pub events: Vec<InputEvent>,
    pub shell_intents: Vec<ShellIntent>,
    pub session_intents: Vec<SessionIntent>,
}

#[derive(Clone, Debug, PartialEq)]
pub enum HostEffect {
    LeaveGame,
    PersistSettings(Vec<u8>),
    SetTextCapture {
        active: bool,
        x: f32,
        y: f32,
        w: f32,
        h: f32,
        max_len: u32,
    },
}

pub fn route(
    decoded: &DecodedInput<'_>,
    shell_open: bool,
    text_capture_active: bool,
) -> RoutedInput {
    let mut routed = RoutedInput::default();
    for event in decoded.events {
        let code = KeyCode::from_u16(event.code);
        let kind = EventKind::from_u8(event.kind);
        if code == KeyCode::Escape {
            if kind == EventKind::KeyDown {
                if text_capture_active {
                    routed.session_intents.push(SessionIntent::CancelChat);
                } else if shell_open {
                    routed.shell_intents.push(ShellIntent::Back);
                } else {
                    routed.shell_intents.push(ShellIntent::Open);
                }
            }
            continue;
        }
        if kind == EventKind::KeyDown {
            if !text_capture_active && !shell_open {
                if code == KeyCode::KeyT {
                    routed
                        .session_intents
                        .push(SessionIntent::OpenChat { prefill: String::new() });
                    continue;
                }
                if code == KeyCode::Slash {
                    routed.session_intents.push(SessionIntent::OpenChat {
                        prefill: "/".to_owned(),
                    });
                    continue;
                }
            }
        }
        routed.events.push(*event);
    }
    routed
}

#[cfg(test)]
mod tests {
    use od_core::{
        INPUT_KIND_KEY_DOWN, INPUT_KIND_KEY_UP, InputEvent, InputQueueHeader, InputSampled, KeyCode,
    };

    use crate::input::DecodedInput;

    use super::*;

    #[test]
    fn escape_prefers_capture_cancel() {
        let events = [
            InputEvent {
                kind: INPUT_KIND_KEY_DOWN,
                modifiers: 0,
                code: KeyCode::Escape as u16,
                value: 0,
            },
            InputEvent {
                kind: INPUT_KIND_KEY_UP,
                modifiers: 0,
                code: KeyCode::Escape as u16,
                value: 0,
            },
        ];
        let decoded = DecodedInput {
            sampled: InputSampled::default(),
            queue: InputQueueHeader {
                count: events.len() as u32,
                overflow: 0,
            },
            events: &events,
        };

        let routed = route(&decoded, true, true);
        assert_eq!(routed.session_intents, vec![SessionIntent::CancelChat]);
        assert!(routed.shell_intents.is_empty());
    }

    #[test]
    fn escape_is_consumed_before_keymap() {
        let events = [
            InputEvent {
                kind: INPUT_KIND_KEY_DOWN,
                modifiers: 0,
                code: KeyCode::Escape as u16,
                value: 0,
            },
            InputEvent {
                kind: INPUT_KIND_KEY_UP,
                modifiers: 0,
                code: KeyCode::Escape as u16,
                value: 0,
            },
            InputEvent {
                kind: INPUT_KIND_KEY_DOWN,
                modifiers: 0,
                code: KeyCode::KeyQ as u16,
                value: 0,
            },
        ];
        let decoded = DecodedInput {
            sampled: InputSampled::default(),
            queue: InputQueueHeader {
                count: events.len() as u32,
                overflow: 0,
            },
            events: &events,
        };

        let routed = route(&decoded, false, false);
        assert_eq!(routed.shell_intents, vec![ShellIntent::Open]);
        assert_eq!(routed.events.len(), 1);
        assert_eq!(routed.events[0].code, KeyCode::KeyQ as u16);
    }
}
