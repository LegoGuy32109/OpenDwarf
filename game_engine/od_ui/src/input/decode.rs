use od_core::{
    INPUT_ARENA_EVENTS_OFFSET, INPUT_ARENA_QUEUE_OFFSET, INPUT_ARENA_SAMPLE_OFFSET,
    INPUT_ARENA_SIZE_BYTES, InputArena, InputEvent, InputQueueHeader, InputSampled,
};

#[derive(Clone, Copy, Debug)]
pub struct DecodedInput<'a> {
    pub sampled: InputSampled,
    pub queue: InputQueueHeader,
    pub events: &'a [InputEvent],
}

pub fn decode(bytes: &[u8]) -> Option<DecodedInput<'_>> {
    let arena_size = INPUT_ARENA_SIZE_BYTES as usize;
    if bytes.len() < arena_size {
        return None;
    }

    let sampled = bytemuck::pod_read_unaligned(
        bytes.get(INPUT_ARENA_SAMPLE_OFFSET..INPUT_ARENA_QUEUE_OFFSET)?,
    );
    let queue: InputQueueHeader = bytemuck::pod_read_unaligned(
        bytes.get(INPUT_ARENA_QUEUE_OFFSET..INPUT_ARENA_EVENTS_OFFSET)?,
    );
    let events_bytes = bytes.get(INPUT_ARENA_EVENTS_OFFSET..arena_size)?;
    let events = bytemuck::try_cast_slice(events_bytes).ok()?;
    let count = queue.count.min(events.len() as u32) as usize;
    Some(DecodedInput {
        sampled,
        queue,
        events: &events[..count],
    })
}

#[allow(dead_code)]
pub fn decode_arena(arena: &InputArena) -> DecodedInput<'_> {
    let events = &arena.events[..arena.queue.count.min(arena.events.len() as u32) as usize];
    DecodedInput {
        sampled: arena.sampled,
        queue: arena.queue,
        events,
    }
}

#[cfg(test)]
mod tests {
    use bytemuck::bytes_of;

    use od_core::{
        EventKind, InputArena, InputEvent, InputQueueHeader, InputSampled, KeyCode,
        INPUT_KIND_KEY_DOWN,
    };

    use super::*;

    #[test]
    fn decodes_an_input_arena() {
        let mut arena = InputArena::default();
        arena.sampled = InputSampled {
            framebuffer_w: 1280,
            framebuffer_h: 720,
            dpr: 2.0,
            dt_ms: 16.0,
            window_focused: 1,
            pointer_x: 0.0,
            pointer_y: 0.0,
            buttons: 0,
        };
        arena.queue = InputQueueHeader {
            count: 1,
            overflow: 0,
        };
        arena.events[0] = InputEvent {
            kind: INPUT_KIND_KEY_DOWN,
            modifiers: 0,
            code: KeyCode::Enter as u16,
            value: 0,
        };

        let decoded = decode(bytes_of(&arena)).expect("arena should decode");
        let decoded_from_arena = decode_arena(&arena);
        assert_eq!(decoded.sampled.framebuffer_w, 1280);
        assert_eq!(decoded.sampled.dpr, 2.0);
        assert_eq!(decoded.queue.count, 1);
        assert_eq!(decoded.events.len(), 1);
        assert_eq!(decoded.events[0].kind, EventKind::KeyDown as u8);
        assert_eq!(decoded_from_arena.events.len(), 1);
    }
}
