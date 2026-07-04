use bytemuck::{Pod, Zeroable};
use serde::{Deserialize, Serialize};
use std::mem;

pub const INPUT_SAMPLE_FRAMEBUFFER_W_OFFSET: usize = 0;
pub const INPUT_SAMPLE_FRAMEBUFFER_H_OFFSET: usize = 4;
pub const INPUT_SAMPLE_DPR_OFFSET: usize = 8;
pub const INPUT_SAMPLE_DT_MS_OFFSET: usize = 12;
pub const INPUT_SAMPLE_WINDOW_FOCUSED_OFFSET: usize = 16;
pub const INPUT_SAMPLE_POINTER_X_OFFSET: usize = 20;
pub const INPUT_SAMPLE_POINTER_Y_OFFSET: usize = 24;
pub const INPUT_SAMPLE_BUTTONS_OFFSET: usize = 28;
pub const INPUT_SAMPLED_SIZE_BYTES: u32 = mem::size_of::<InputSampled>() as u32;

pub const INPUT_QUEUE_HEADER_COUNT_OFFSET: usize = 0;
pub const INPUT_QUEUE_HEADER_OVERFLOW_OFFSET: usize = 4;
pub const INPUT_QUEUE_HEADER_SIZE_BYTES: u32 = mem::size_of::<InputQueueHeader>() as u32;

pub const INPUT_EVENT_KIND_OFFSET: usize = 0;
pub const INPUT_EVENT_MODIFIERS_OFFSET: usize = 1;
pub const INPUT_EVENT_CODE_OFFSET: usize = 2;
pub const INPUT_EVENT_VALUE_OFFSET: usize = 4;
pub const INPUT_EVENT_SIZE_BYTES: u32 = mem::size_of::<InputEvent>() as u32;

pub const INPUT_QUEUE_CAPACITY: u32 = 1024;
pub const INPUT_ARENA_SAMPLE_OFFSET: usize = 0;
pub const INPUT_ARENA_QUEUE_OFFSET: usize = INPUT_SAMPLED_SIZE_BYTES as usize;
pub const INPUT_ARENA_EVENTS_OFFSET: usize =
    INPUT_ARENA_QUEUE_OFFSET + INPUT_QUEUE_HEADER_SIZE_BYTES as usize;
pub const INPUT_ARENA_SIZE_BYTES: u32 = mem::size_of::<InputArena>() as u32;

pub const INPUT_KIND_UNKNOWN: u8 = EventKind::Unknown as u8;
pub const INPUT_KIND_KEY_DOWN: u8 = EventKind::KeyDown as u8;
pub const INPUT_KIND_KEY_UP: u8 = EventKind::KeyUp as u8;
pub const INPUT_KIND_BLUR: u8 = EventKind::Blur as u8;
pub const INPUT_KIND_RESYNC: u8 = EventKind::Resync as u8;

pub const INPUT_MODIFIER_SHIFT: u8 = 1 << 0;
pub const INPUT_MODIFIER_CTRL: u8 = 1 << 1;
pub const INPUT_MODIFIER_ALT: u8 = 1 << 2;
pub const INPUT_MODIFIER_META: u8 = 1 << 3;

#[repr(u8)]
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub enum EventKind {
    Unknown = 0,
    KeyDown = 1,
    KeyUp = 2,
    Blur = 3,
    Resync = 4,
}

impl EventKind {
    pub const fn from_u8(value: u8) -> Self {
        match value {
            1 => Self::KeyDown,
            2 => Self::KeyUp,
            3 => Self::Blur,
            4 => Self::Resync,
            _ => Self::Unknown,
        }
    }

    pub const fn as_u8(self) -> u8 {
        self as u8
    }
}

#[repr(C)]
#[derive(Clone, Copy, Debug, Default, Pod, Zeroable, Serialize, Deserialize)]
pub struct InputSampled {
    pub framebuffer_w: u32,
    pub framebuffer_h: u32,
    pub dpr: f32,
    pub dt_ms: f32,
    pub window_focused: u32,
    pub pointer_x: f32,
    pub pointer_y: f32,
    pub buttons: u32,
}

#[repr(C)]
#[derive(Clone, Copy, Debug, Default, Pod, Zeroable, Serialize, Deserialize)]
pub struct InputQueueHeader {
    pub count: u32,
    pub overflow: u32,
}

#[repr(C)]
#[derive(Clone, Copy, Debug, Default, Pod, Zeroable, Serialize, Deserialize)]
pub struct InputEvent {
    pub kind: u8,
    pub modifiers: u8,
    pub code: u16,
    pub value: u32,
}

#[repr(C)]
#[derive(Clone, Copy, Debug, Pod, Zeroable)]
pub struct InputArena {
    pub sampled: InputSampled,
    pub queue: InputQueueHeader,
    pub events: [InputEvent; INPUT_QUEUE_CAPACITY as usize],
}

impl Default for InputArena {
    fn default() -> Self {
        Self {
            sampled: InputSampled::default(),
            queue: InputQueueHeader::default(),
            events: [InputEvent::default(); INPUT_QUEUE_CAPACITY as usize],
        }
    }
}

impl InputArena {
    pub fn clear_queue(&mut self) {
        self.queue.count = 0;
        self.queue.overflow = 0;
    }
}

const _: () = assert!(mem::size_of::<InputSampled>() == INPUT_SAMPLED_SIZE_BYTES as usize);
const _: () =
    assert!(mem::offset_of!(InputSampled, framebuffer_w) == INPUT_SAMPLE_FRAMEBUFFER_W_OFFSET);
const _: () =
    assert!(mem::offset_of!(InputSampled, framebuffer_h) == INPUT_SAMPLE_FRAMEBUFFER_H_OFFSET);
const _: () = assert!(mem::offset_of!(InputSampled, dpr) == INPUT_SAMPLE_DPR_OFFSET);
const _: () = assert!(mem::offset_of!(InputSampled, dt_ms) == INPUT_SAMPLE_DT_MS_OFFSET);
const _: () =
    assert!(mem::offset_of!(InputSampled, window_focused) == INPUT_SAMPLE_WINDOW_FOCUSED_OFFSET);
const _: () = assert!(mem::offset_of!(InputSampled, pointer_x) == INPUT_SAMPLE_POINTER_X_OFFSET);
const _: () = assert!(mem::offset_of!(InputSampled, pointer_y) == INPUT_SAMPLE_POINTER_Y_OFFSET);
const _: () = assert!(mem::offset_of!(InputSampled, buttons) == INPUT_SAMPLE_BUTTONS_OFFSET);

const _: () = assert!(mem::size_of::<InputQueueHeader>() == INPUT_QUEUE_HEADER_SIZE_BYTES as usize);
const _: () = assert!(mem::offset_of!(InputQueueHeader, count) == INPUT_QUEUE_HEADER_COUNT_OFFSET);
const _: () =
    assert!(mem::offset_of!(InputQueueHeader, overflow) == INPUT_QUEUE_HEADER_OVERFLOW_OFFSET);

const _: () = assert!(mem::size_of::<InputEvent>() == INPUT_EVENT_SIZE_BYTES as usize);
const _: () = assert!(mem::offset_of!(InputEvent, kind) == INPUT_EVENT_KIND_OFFSET);
const _: () = assert!(mem::offset_of!(InputEvent, modifiers) == INPUT_EVENT_MODIFIERS_OFFSET);
const _: () = assert!(mem::offset_of!(InputEvent, code) == INPUT_EVENT_CODE_OFFSET);
const _: () = assert!(mem::offset_of!(InputEvent, value) == INPUT_EVENT_VALUE_OFFSET);

const _: () = assert!(mem::size_of::<InputArena>() == INPUT_ARENA_SIZE_BYTES as usize);
