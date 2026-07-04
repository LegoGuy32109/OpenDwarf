use od_core::{EventKind, InputEvent, KeyCode};

use crate::{ShellIntent, input::DecodedInput};

#[derive(Clone, Debug, Default)]
pub struct RoutedInput {
    pub events: Vec<InputEvent>,
    pub shell_intents: Vec<ShellIntent>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum HostEffect {
    LeaveGame,
    PersistSettings(Vec<u8>),
}

pub fn route(decoded: &DecodedInput<'_>, shell_open: bool) -> RoutedInput {
    let mut routed = RoutedInput::default();
    for event in decoded.events {
        let code = KeyCode::from_u16(event.code);
        if code == KeyCode::Escape {
            if EventKind::from_u8(event.kind) == EventKind::KeyDown {
                routed.shell_intents.push(if shell_open {
                    ShellIntent::Back
                } else {
                    ShellIntent::Open
                });
            }
            continue;
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

        let routed = route(&decoded, false);
        assert_eq!(routed.shell_intents, vec![ShellIntent::Open]);
        assert_eq!(routed.events.len(), 1);
        assert_eq!(routed.events[0].code, KeyCode::KeyQ as u16);
    }
}
