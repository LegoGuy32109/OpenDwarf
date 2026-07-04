use std::{any::Any, collections::HashMap};

use crate::{id::Id, primitives::Rect};

#[derive(Debug)]
pub struct RetainedEntry {
    pub last_rect: Rect,
    pub frame_touched: u64,
    pub state: Option<Box<dyn Any>>,
}

#[derive(Debug, Default)]
pub struct Retained {
    pub(crate) map: HashMap<Id, RetainedEntry>,
    pub(crate) frame: u64,
}

impl Retained {
    pub fn touch(&mut self, id: Id, rect: Rect) {
        let entry = self.map.entry(id).or_insert_with(|| RetainedEntry {
            last_rect: Rect::zero(),
            frame_touched: self.frame,
            state: None,
        });
        entry.last_rect = rect;
        entry.frame_touched = self.frame;
    }

    pub fn last_rect(&self, id: Id) -> Option<Rect> {
        self.map.get(&id).map(|entry| entry.last_rect)
    }

    pub fn prune(&mut self) {
        let frame = self.frame;
        self.map.retain(|_, entry| entry.frame_touched == frame);
    }
}
