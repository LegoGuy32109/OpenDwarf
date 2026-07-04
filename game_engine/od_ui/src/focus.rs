use crate::id::Id;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Focus {
    Linear,
    Grid { cols: u32 },
}

impl Default for Focus {
    fn default() -> Self {
        Self::Linear
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Dir {
    Up,
    Down,
    Left,
    Right,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum UiIntent {
    FocusNext,
    FocusPrev,
    GridMove(Dir),
    Activate,
    Cancel,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct FocusScopeFrame {
    pub(crate) id: Id,
    pub(crate) mode: Focus,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct FocusableEntry {
    pub(crate) id: Id,
    pub(crate) scope_id: Id,
    pub(crate) mode: Focus,
}

pub(crate) fn resolve_focus(
    current: Option<Id>,
    prev_focusables: &[FocusableEntry],
    intents: &[UiIntent],
) -> (Option<Id>, bool) {
    let mut focus = current;
    let mut activate = false;
    for intent in intents {
        match *intent {
            UiIntent::FocusNext => {
                focus = step_focus(prev_focusables, focus, 1);
            }
            UiIntent::FocusPrev => {
                focus = step_focus(prev_focusables, focus, -1);
            }
            UiIntent::GridMove(dir) => {
                focus = grid_move(prev_focusables, focus, dir);
            }
            UiIntent::Activate => {
                activate = focus.is_some();
            }
            UiIntent::Cancel => {}
        }
    }
    (focus, activate)
}

pub(crate) fn next_focus_after_build(
    current: Option<Id>,
    focusables: &[FocusableEntry],
) -> Option<Id> {
    if let Some(current) = current
        && focusables.iter().any(|entry| entry.id == current)
    {
        return Some(current);
    }
    focusables.first().map(|entry| entry.id)
}

fn step_focus(focusables: &[FocusableEntry], current: Option<Id>, delta: isize) -> Option<Id> {
    let scope_id = current
        .and_then(|current| {
            focusables
                .iter()
                .find(|entry| entry.id == current)
                .map(|entry| entry.scope_id)
        })
        .or_else(|| focusables.first().map(|entry| entry.scope_id))?;
    let entries: Vec<&FocusableEntry> = focusables
        .iter()
        .filter(|entry| entry.scope_id == scope_id)
        .collect();
    if entries.is_empty() {
        return None;
    }
    let current_index = current
        .and_then(|current| entries.iter().position(|entry| entry.id == current))
        .unwrap_or(0);
    let len = entries.len() as isize;
    let next = (current_index as isize + delta).rem_euclid(len) as usize;
    Some(entries[next].id)
}

fn grid_move(focusables: &[FocusableEntry], current: Option<Id>, dir: Dir) -> Option<Id> {
    let current = current?;
    let entry = focusables.iter().find(|entry| entry.id == current)?;
    let Focus::Grid { cols } = entry.mode else {
        return Some(current);
    };
    let entries: Vec<&FocusableEntry> = focusables
        .iter()
        .filter(|candidate| candidate.scope_id == entry.scope_id)
        .collect();
    let index = entries
        .iter()
        .position(|candidate| candidate.id == current)?;
    let cols = cols.max(1) as usize;
    let row = index / cols;
    let col = index % cols;
    let len = entries.len();
    let target = match dir {
        Dir::Left => index.saturating_sub(1),
        Dir::Right => {
            if col + 1 >= cols || index + 1 >= len {
                index
            } else {
                index + 1
            }
        }
        Dir::Up => {
            if row == 0 {
                index
            } else {
                let target = index.saturating_sub(cols);
                target.min(len.saturating_sub(1))
            }
        }
        Dir::Down => {
            let target = index + cols;
            target.min(len.saturating_sub(1))
        }
    };
    Some(entries[target].id)
}
