use crate::{FontMetrics, Id, TextStyle, Ui, ui::Response};

use super::state::TextState;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct TextFieldResponse {
    pub id: Id,
}

impl<'a, M: FontMetrics> Ui<'a, M> {
    pub fn text_field(
        &mut self,
        key: &str,
        state: &TextState,
        cfg: TextStyle,
        active: bool,
    ) -> TextFieldResponse {
        let node_index = self.build.push_text_field(
            key,
            state.buf.clone(),
            cfg,
            state.caret,
            state.scroll_px,
            state.blink_ms,
            state.max_len,
            active,
        );
        let id = self.build.nodes[node_index].id;
        TextFieldResponse { id }
    }
}

impl From<TextFieldResponse> for Response {
    fn from(value: TextFieldResponse) -> Self {
        Self {
            id: value.id,
            rect: Default::default(),
            focused: false,
            activated: false,
        }
    }
}
