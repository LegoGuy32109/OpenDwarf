use od_core::{ChatMsg, SessionModel, TextEdit};

use crate::{
    Alignment, Axis, FontMetrics, Layout, Padding, Sizing, TextStyle, Ui,
    text::{state::TextState, text_px},
    theme::Theme,
};

pub const CHAT_MAX_LEN: usize = 256;

pub fn chat_state(model: &SessionModel) -> TextState {
    TextState::from_model(
        model.chat_draft.clone(),
        model.chat_caret,
        CHAT_MAX_LEN,
        model.chat_scroll_px,
        model.chat_blink_ms,
    )
}

fn apply_state(model: &mut SessionModel, state: TextState) {
    model.chat_draft = state.buf;
    model.chat_caret = state.caret;
    model.chat_scroll_px = state.scroll_px.max(0.0);
    model.chat_blink_ms = state.blink_ms.max(0.0);
}

pub fn open_chat(model: &mut SessionModel, prefill: String) {
    let mut state = chat_state(model);
    state.set_prefill(prefill);
    apply_state(model, state);
}

pub fn apply_chat_edit<M: FontMetrics>(
    model: &mut SessionModel,
    edit: TextEdit,
    font: &M,
) -> bool {
    let mut state = chat_state(model);
    let changed = state.apply_edit(edit, |ch| font.accepts_text_char(ch));
    if changed {
        apply_state(model, state);
    }
    changed
}

pub fn submit_chat(model: &mut SessionModel) -> Option<String> {
    let mut state = chat_state(model);
    let submitted = state.submit_trimmed();
    if let Some(text) = submitted.as_ref() {
        model.push_message(ChatMsg::new(text.clone()));
    }
    apply_state(model, state);
    submitted
}

pub fn cancel_chat(model: &mut SessionModel) {
    let mut state = chat_state(model);
    state.clear();
    apply_state(model, state);
}

pub fn tick_chat(model: &mut SessionModel, dt_ms: f32, active: bool) {
    if active {
        model.chat_blink_ms = (model.chat_blink_ms + dt_ms.max(0.0)).max(0.0);
    }
}

pub fn recommend_scroll_px<M: FontMetrics>(
    model: &SessionModel,
    font: &M,
    theme: Theme,
    scale: f32,
    field_inner_width: f32,
) -> f32 {
    let px = text_px(&TextStyle::default(), theme, scale);
    let state = chat_state(model);
    recommend_scroll_from_state(font, px, &state, field_inner_width)
}

pub fn recommend_scroll_from_state<M: FontMetrics>(
    font: &M,
    px: f32,
    state: &TextState,
    field_inner_width: f32,
) -> f32 {
    if field_inner_width <= 0.0 {
        return 0.0;
    }

    let caret = state.caret.min(state.buf.len());
    let prefix = &state.buf[..caret];
    let caret_x = font.measure_line(prefix, px).x;
    let text_width = font.measure_line(&state.buf, px).x;
    let caret_width = font.advance(' ', px).max(1.0);
    let max_scroll = (text_width - field_inner_width + caret_width).max(0.0);
    let mut scroll = state.scroll_px.max(0.0);

    if caret_x < scroll {
        scroll = caret_x;
    }
    if caret_x - scroll > field_inner_width - caret_width {
        scroll = caret_x - field_inner_width + caret_width;
    }

    scroll.clamp(0.0, max_scroll)
}

pub fn build_session<M: FontMetrics>(
    ui: &mut Ui<'_, M>,
    model: &SessionModel,
    capture_active: bool,
) -> Option<crate::Id> {
    let mut chat_field_id = None;
    ui.column(
        Layout::new()
            .grow()
            .align(Alignment::Center, Alignment::End),
        |ui| {
            ui.panel(
                crate::Style::default()
                    .bg(ui.build.theme.panel_bg)
                    .border_with(ui.build.theme.border, 1.0),
                |ui| {
                    ui.column(
                        Layout::new().pad(Padding::all(10.0)).gap(6.0),
                        |ui| {
                            ui.text("Session", TextStyle::default());
                            ui.text(
                                if capture_active { "Chat active" } else { "World" },
                                TextStyle::default(),
                            );
                            let visible = model.messages.iter().rev().take(3).rev();
                            for msg in visible {
                                ui.text(&msg.text, TextStyle::default());
                            }
                        },
                    );
                },
            );
            if capture_active {
                ui.row(
                    Layout::new()
                        .row()
                        .sizing(Axis::Row, Sizing::grow())
                        .pad(Padding::xy(12.0, 12.0)),
                    |ui| {
                        let state = chat_state(model);
                        let response = ui.text_field(
                            "chat_field",
                            &state,
                            TextStyle::default().wrap(false),
                            true,
                        );
                        chat_field_id = Some(response.id);
                    },
                );
            }
        },
    );
    chat_field_id
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{font::MonospaceVga, theme::Theme};

    #[test]
    fn chat_model_open_edit_submit_cancel_preserves_model_state() {
        let mut model = SessionModel::default();
        model.chat_scroll_px = 24.0;
        model.chat_blink_ms = 48.0;

        open_chat(&mut model, "hello".to_owned());
        assert_eq!(model.chat_draft, "hello");
        assert_eq!(model.chat_caret, 5);
        assert_eq!(model.chat_scroll_px, 0.0);
        assert_eq!(model.chat_blink_ms, 0.0);

        model.chat_blink_ms = 32.0;
        assert!(apply_chat_edit(&mut model, TextEdit::InsertText(' '), &MonospaceVga));
        assert_eq!(model.chat_draft, "hello ");
        assert_eq!(model.chat_blink_ms, 0.0);

        assert!(apply_chat_edit(&mut model, TextEdit::InsertText('w'), &MonospaceVga));
        assert_eq!(model.chat_draft, "hello w");
        assert!(apply_chat_edit(&mut model, TextEdit::CaretLeft, &MonospaceVga));
        assert_eq!(model.chat_blink_ms, 0.0);

        let submitted = submit_chat(&mut model);
        assert_eq!(submitted.as_deref(), Some("hello w"));
        assert_eq!(model.chat_draft, "");
        assert_eq!(model.chat_caret, 0);
        assert_eq!(model.chat_scroll_px, 0.0);
        assert_eq!(model.chat_blink_ms, 0.0);

        model.chat_scroll_px = 18.0;
        model.chat_blink_ms = 27.0;
        cancel_chat(&mut model);
        assert_eq!(model.chat_draft, "");
        assert_eq!(model.chat_caret, 0);
        assert_eq!(model.chat_scroll_px, 0.0);
        assert_eq!(model.chat_blink_ms, 0.0);
    }

    #[test]
    fn blink_advances_only_while_active() {
        let mut model = SessionModel::default();
        tick_chat(&mut model, 16.0, false);
        assert_eq!(model.chat_blink_ms, 0.0);
        open_chat(&mut model, "a".to_owned());
        tick_chat(&mut model, 16.0, true);
        assert_eq!(model.chat_blink_ms, 16.0);
        let _ = apply_chat_edit(&mut model, TextEdit::CaretLeft, &MonospaceVga);
        assert_eq!(model.chat_blink_ms, 0.0);
    }

    #[test]
    fn scroll_recommendation_moves_right_for_long_drafts() {
        let mut model = SessionModel::default();
        model.chat_draft = "hello world hello world hello world".to_owned();
        model.chat_caret = model.chat_draft.len();
        model.chat_scroll_px = 0.0;
        let scroll = recommend_scroll_px(&model, &MonospaceVga, Theme::default(), 1.0, 64.0);
        assert!(scroll > 0.0);
    }
}
