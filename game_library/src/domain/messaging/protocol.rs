use bevy::prelude::warn;

use super::{GameMessage, MESSAGE_QUEUE};

#[allow(dead_code)]
const OP_FLIP_PLAYER_SPRITE: u8 = 1;
#[allow(dead_code)]
const OP_LOG_DEBUG: u8 = 2;

#[allow(dead_code)]
pub fn enqueue_messages_from_bytes(data: &[u8]) -> Result<(), String> {
    let mut queue = MESSAGE_QUEUE.lock().expect("message queue poisoned");

    let mut cursor = 0;
    while cursor < data.len() {
        let Some(&op_code) = data.get(cursor) else {
            warn!("Empty opcode in wasm message");
            return Err("Empty opcode in wasm message".to_string());
        };
        cursor += 1;
        match op_code {
            OP_FLIP_PLAYER_SPRITE => {
                queue.push_back(GameMessage::FlipPlayerSprite);
            }
            OP_LOG_DEBUG => {
                let Some(&length) = data.get(cursor) else {
                    warn!("Message length missing");
                    return Err("Message length missing".to_string());
                };
                let Some(&length_2) = data.get(cursor + 1) else {
                    warn!("Message length missing");
                    return Err("Message length missing".to_string());
                };
                let length = length as usize + (length_2 as usize) << 8;
                cursor += 2;

                let Some(bytes) = data.get(cursor..cursor + length) else {
                    warn!("Not enough bytes for string");
                    return Err("Not enough bytes for string".to_string());
                };
                cursor += length;

                let Ok(msg) = String::from_utf8(bytes.to_vec()) else {
                    warn!("Invalid utf-8 in log message");
                    return Err("Invalid utf-8 in log message".to_string());
                };
                queue.push_back(GameMessage::Log(msg));
            }
            _ => {
                warn!("Unknown opcode {op_code} in wasm message");
                return Err(format!("Unknown opcode {op_code} in wasm message"));
            }
        }
    }

    Ok(())
}
