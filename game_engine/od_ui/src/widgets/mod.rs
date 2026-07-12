use std::{collections::HashSet, hash::Hash};

use crate::{
    Axis, Id, Layout,
    focus::{Focus, FocusScopeFrame},
    font::FontMetrics,
    primitives::Color,
    text::TextRun,
    theme::{Style, TextStyle},
    ui::{NodeKind, Response, ScopeFrame, Ui},
};

impl<'a, M: FontMetrics> Ui<'a, M> {
    pub fn scope<R>(&mut self, key: impl Hash, f: impl FnOnce(&mut Ui<'_, M>) -> R) -> R {
        let id = self.build.alloc_child_id(Some(key));
        self.build.scope_stack.push(ScopeFrame {
            id,
            #[cfg(debug_assertions)]
            sibling_ids: HashSet::new(),
            next_child_index: 0,
        });
        let result = f(self);
        let _ = self.build.scope_stack.pop();
        result
    }

    pub fn column<R>(&mut self, layout: Layout, f: impl FnOnce(&mut Ui<'_, M>) -> R) -> R {
        let mut layout = layout;
        layout.direction = Axis::Column;
        let node_index = self.build.begin_flow_container(layout, None);
        if matches!(layout.focus, Focus::Linear | Focus::Grid { .. }) {
            self.build.focus_scope_stack.push(FocusScopeFrame {
                id: self.build.nodes[node_index].id,
                mode: layout.focus,
            });
        }
        let result = f(self);
        if matches!(layout.focus, Focus::Linear | Focus::Grid { .. }) {
            let _ = self.build.focus_scope_stack.pop();
        }
        let _ = self.build.node_stack.pop();
        result
    }

    pub fn row<R>(&mut self, layout: Layout, f: impl FnOnce(&mut Ui<'_, M>) -> R) -> R {
        let mut layout = layout;
        layout.direction = Axis::Row;
        let node_index = self.build.begin_flow_container(layout, None);
        if matches!(layout.focus, Focus::Linear | Focus::Grid { .. }) {
            self.build.focus_scope_stack.push(FocusScopeFrame {
                id: self.build.nodes[node_index].id,
                mode: layout.focus,
            });
        }
        let result = f(self);
        if matches!(layout.focus, Focus::Linear | Focus::Grid { .. }) {
            let _ = self.build.focus_scope_stack.pop();
        }
        let _ = self.build.node_stack.pop();
        result
    }

    pub fn grid<R>(&mut self, layout: Layout, f: impl FnOnce(&mut Ui<'_, M>) -> R) -> R {
        let mut layout = layout;
        layout.direction = Axis::Row;
        let node_index = self.build.begin_flow_container(layout, None);
        if matches!(layout.focus, Focus::Linear | Focus::Grid { .. }) {
            self.build.focus_scope_stack.push(FocusScopeFrame {
                id: self.build.nodes[node_index].id,
                mode: layout.focus,
            });
        }
        let result = f(self);
        if matches!(layout.focus, Focus::Linear | Focus::Grid { .. }) {
            let _ = self.build.focus_scope_stack.pop();
        }
        let _ = self.build.node_stack.pop();
        result
    }

    pub fn panel<R>(&mut self, style: Style, f: impl FnOnce(&mut Ui<'_, M>) -> R) -> R {
        let _ = self.build.begin_panel(style);
        let result = f(self);
        self.build.end_panel();
        result
    }

    pub fn spacer(&mut self, layout: Layout) -> Id {
        let node_index = self.build.push_leaf_node(NodeKind::Spacer, layout);
        self.build.nodes[node_index].id
    }

    pub fn text(&mut self, text: &str, cfg: TextStyle) -> Id {
        self.text_runs(&[(text, cfg.color.unwrap_or(self.build.theme.text))], cfg)
    }

    pub fn text_runs(&mut self, runs: &[(&str, Color)], cfg: TextStyle) -> Id {
        let node_index = self.build.push_leaf_node(
            NodeKind::Text {
                runs: runs
                    .iter()
                    .map(|(text, color)| TextRun {
                        text: (*text).to_string(),
                        color: *color,
                    })
                    .collect(),
                cfg,
            },
            Layout::new(),
        );
        self.build.nodes[node_index].id
    }

    pub fn button(&mut self, key: &str, label: &str) -> Response {
        self.build.push_button(key, label, TextStyle::default().wrap(false))
    }
}
