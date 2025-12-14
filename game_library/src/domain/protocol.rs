use super::{GameMessage, MESSAGE_QUEUE};

pub const OP_FLIP_PLAYER_SPRITE: u8 = 1;
pub const OP_LOG_DEBUG: u8 = 2;

/// Decode a byte buffer into game messages and enqueue them.
/// Protocol:
/// - `OP_FLIP_PLAYER_SPRITE` (no payload)
/// - `OP_LOG_DEBUG`\[u16 len LE\]\[len bytes utf-8\] (log message)
///
///   Unknown opcodes are skipped to allow forward-compatible extensions.
pub fn enqueue_messages_from_bytes(bytes: &[u8]) -> Result<(), &'static str> {
    let mut queue = MESSAGE_QUEUE.lock().map_err(|_| "queue poisoned")?;
    let mut cursor = 0;
    while cursor < bytes.len() {
        match bytes[cursor] {
            OP_FLIP_PLAYER_SPRITE => {
                queue.push_back(GameMessage::FlipPlayerSprite);
                cursor += 1;
            }
            OP_LOG_DEBUG => {
                if cursor + 2 >= bytes.len() {
                    return Err("truncated log length");
                }
                let len = u16::from_le_bytes([bytes[cursor + 1], bytes[cursor + 2]]) as usize;
                cursor += 3;
                if cursor + len > bytes.len() {
                    return Err("truncated log payload");
                }
                let msg_bytes = &bytes[cursor..cursor + len];
                let msg = String::from_utf8_lossy(msg_bytes).into_owned();
                queue.push_back(GameMessage::Log(msg));
                cursor += len;
            }
            _ => {
                // skip unknown opcode
                cursor += 1;
            }
        }
    }
    Ok(())
}
