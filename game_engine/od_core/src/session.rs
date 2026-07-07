use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct ChatMsg {
    pub text: String,
}

impl ChatMsg {
    pub fn new(text: impl Into<String>) -> Self {
        Self { text: text.into() }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub enum TextEdit {
    InsertText(char),
    DeleteBack,
    DeleteFwd,
    DeleteWordBack,
    CaretLeft,
    CaretRight,
    CaretHome,
    CaretEnd,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub enum SessionIntent {
    OpenChat { prefill: String },
    EditChat(TextEdit),
    SubmitChat,
    CancelChat,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct SessionModel {
    pub chat_draft: String,
    pub chat_caret: usize,
    pub chat_scroll_px: f32,
    pub chat_blink_ms: f32,
    pub messages: Vec<ChatMsg>,
}

impl Default for SessionModel {
    fn default() -> Self {
        Self {
            chat_draft: String::new(),
            chat_caret: 0,
            chat_scroll_px: 0.0,
            chat_blink_ms: 0.0,
            messages: Vec::new(),
        }
    }
}

impl SessionModel {
    pub const MAX_MESSAGES: usize = 20;

    pub fn push_message(&mut self, message: ChatMsg) {
        self.messages.push(message);
        if self.messages.len() > Self::MAX_MESSAGES {
            let overflow = self.messages.len() - Self::MAX_MESSAGES;
            self.messages.drain(0..overflow);
        }
    }
}
