use od_core::TextEdit;

use crate::FontMetrics;

#[derive(Clone, Debug, PartialEq)]
pub struct TextState {
    pub buf: String,
    pub caret: usize,
    pub max_len: usize,
    pub scroll_px: f32,
    pub blink_ms: f32,
}

impl TextState {
    pub fn new(buf: impl Into<String>, caret: usize, max_len: usize) -> Self {
        let mut state = Self {
            buf: buf.into(),
            caret,
            max_len,
            scroll_px: 0.0,
            blink_ms: 0.0,
        };
        state.clamp_caret();
        state.clamp_len();
        state
    }

    pub fn empty(max_len: usize) -> Self {
        Self::new("", 0, max_len)
    }

    pub fn from_model(
        buf: impl Into<String>,
        caret: usize,
        max_len: usize,
        scroll_px: f32,
        blink_ms: f32,
    ) -> Self {
        let mut state = Self::new(buf, caret, max_len);
        state.scroll_px = scroll_px.max(0.0);
        state.blink_ms = blink_ms.max(0.0);
        state
    }

    pub fn apply_edit<F: FnMut(char) -> bool>(
        &mut self,
        edit: TextEdit,
        mut accepts_text_char: F,
    ) -> bool {
        let changed = match edit {
            TextEdit::InsertText(ch) => {
                if !accepts_text_char(ch) || self.char_count() >= self.max_len {
                    false
                } else {
                    self.buf.insert(self.caret, ch);
                    self.caret += ch.len_utf8();
                    true
                }
            }
            TextEdit::DeleteBack => self.delete_back(),
            TextEdit::DeleteFwd => self.delete_forward(),
            TextEdit::DeleteWordBack => self.delete_word_back(),
            TextEdit::CaretLeft => self.caret_left(),
            TextEdit::CaretRight => self.caret_right(),
            TextEdit::CaretHome => self.caret_home(),
            TextEdit::CaretEnd => self.caret_end(),
        };
        if changed {
            self.blink_ms = 0.0;
        }
        self.clamp_caret();
        self.clamp_len();
        changed
    }

    pub fn set_prefill(&mut self, text: impl Into<String>) {
        self.buf = text.into();
        self.caret = self.buf.len();
        self.scroll_px = 0.0;
        self.clamp_len();
        self.blink_ms = 0.0;
    }

    pub fn submit_trimmed(&mut self) -> Option<String> {
        let trimmed = self.buf.trim().to_owned();
        self.clear();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed)
        }
    }

    pub fn clear(&mut self) {
        self.buf.clear();
        self.caret = 0;
        self.scroll_px = 0.0;
        self.blink_ms = 0.0;
    }

    pub fn tick(&mut self, dt_ms: f32) {
        self.blink_ms = (self.blink_ms + dt_ms.max(0.0)).max(0.0);
    }

    pub fn prune_unrenderable<M: FontMetrics>(&mut self, font: &M) {
        let caret_chars = self.buf[..self.caret.min(self.buf.len())].chars().count();
        let mut new = String::with_capacity(self.buf.len());
        let mut new_caret_chars = 0_usize;
        for (index, ch) in self.buf.chars().enumerate() {
            if font.accepts_text_char(ch) {
                if index < caret_chars {
                    new_caret_chars += 1;
                }
                new.push(ch);
            }
        }
        self.buf = new;
        self.caret = self.char_to_byte_index(new_caret_chars);
        self.clamp_caret();
        self.clamp_len();
    }

    pub fn char_count(&self) -> usize {
        self.buf.chars().count()
    }

    fn delete_back(&mut self) -> bool {
        if self.caret == 0 {
            return false;
        }
        let prev = self.prev_char_boundary(self.caret);
        self.buf.replace_range(prev..self.caret, "");
        self.caret = prev;
        true
    }

    fn delete_forward(&mut self) -> bool {
        if self.caret >= self.buf.len() {
            return false;
        }
        let next = self.next_char_boundary(self.caret);
        self.buf.replace_range(self.caret..next, "");
        true
    }

    fn delete_word_back(&mut self) -> bool {
        let mut changed = false;
        while self.caret > 0 && self.prev_char(self.caret).is_some_and(char::is_whitespace) {
            changed |= self.delete_back();
        }
        while self.caret > 0 && self.prev_char(self.caret).is_some_and(|ch| !ch.is_whitespace()) {
            changed |= self.delete_back();
        }
        changed
    }

    fn caret_left(&mut self) -> bool {
        if self.caret == 0 {
            return false;
        }
        self.caret = self.prev_char_boundary(self.caret);
        true
    }

    fn caret_right(&mut self) -> bool {
        if self.caret >= self.buf.len() {
            return false;
        }
        self.caret = self.next_char_boundary(self.caret);
        true
    }

    fn caret_home(&mut self) -> bool {
        if self.caret == 0 {
            return false;
        }
        self.caret = 0;
        true
    }

    fn caret_end(&mut self) -> bool {
        if self.caret == self.buf.len() {
            return false;
        }
        self.caret = self.buf.len();
        true
    }

    fn clamp_caret(&mut self) {
        self.caret = self.caret.min(self.buf.len());
        while self.caret > 0 && !self.buf.is_char_boundary(self.caret) {
            self.caret -= 1;
        }
    }

    fn clamp_len(&mut self) {
        let mut truncated = String::with_capacity(self.buf.len());
        let mut count = 0_usize;
        for ch in self.buf.chars() {
            if count >= self.max_len {
                break;
            }
            truncated.push(ch);
            count += 1;
        }
        if count < self.char_count() {
            self.buf = truncated;
            self.caret = self.buf.len();
        }
        self.clamp_caret();
    }

    fn prev_char_boundary(&self, index: usize) -> usize {
        self.buf[..index]
            .char_indices()
            .last()
            .map(|(offset, _)| offset)
            .unwrap_or(0)
    }

    fn next_char_boundary(&self, index: usize) -> usize {
        self.buf[index..]
            .char_indices()
            .nth(1)
            .map(|(offset, _)| index + offset)
            .unwrap_or(self.buf.len())
    }

    fn prev_char(&self, index: usize) -> Option<char> {
        self.buf[..index].chars().next_back()
    }

    fn char_to_byte_index(&self, char_index: usize) -> usize {
        if char_index == 0 {
            return 0;
        }
        self.buf
            .char_indices()
            .nth(char_index)
            .map(|(byte_index, _)| byte_index)
            .unwrap_or(self.buf.len())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::font::MonospaceVga;

    #[test]
    fn insert_delete_and_caret_move() {
        let mut state = TextState::empty(8);
        assert!(state.apply_edit(TextEdit::InsertText('a'), |_| true));
        assert!(state.apply_edit(TextEdit::InsertText('b'), |_| true));
        assert_eq!(state.buf, "ab");
        assert!(state.apply_edit(TextEdit::CaretLeft, |_| true));
        assert!(state.apply_edit(TextEdit::DeleteBack, |_| true));
        assert_eq!(state.buf, "b");
    }

    #[test]
    fn delete_word_back_trims_whitespace_then_word() {
        let mut state = TextState::new("hello  world", 12, 32);
        assert!(state.apply_edit(TextEdit::DeleteWordBack, |_| true));
        assert_eq!(state.buf, "hello  ");
    }

    #[test]
    fn clamp_respects_max_len() {
        let mut state = TextState::new("abcdef", 6, 4);
        state.clamp_len();
        assert_eq!(state.buf, "abcd");
    }

    #[test]
    fn prune_drops_unrenderable_codepoints() {
        let mut state = TextState::new("a🙂b", 6, 8);
        state.prune_unrenderable(&MonospaceVga);
        assert_eq!(state.buf, "ab");
    }

    #[test]
    fn accepts_text_char_allows_space_and_rejects_control_whitespace() {
        let font = MonospaceVga;
        assert!(font.accepts_text_char(' '));
        assert!(!font.accepts_text_char('\t'));
        assert!(!font.accepts_text_char('\n'));
        assert!(!font.accepts_text_char('\r'));
    }

    #[test]
    fn insert_preserves_spaces() {
        let mut state = TextState::empty(8);
        assert!(state.apply_edit(TextEdit::InsertText(' '), |_| true));
        assert!(state.apply_edit(TextEdit::InsertText('a'), |_| true));
        assert_eq!(state.buf, " a");
    }
}
