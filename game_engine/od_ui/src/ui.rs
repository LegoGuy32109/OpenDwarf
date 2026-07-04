use std::{collections::HashMap, hash::Hash};

use od_core::{DrawCmd, GlyphInstance, RectInstance};

use crate::{
    draw::FrameOutput,
    focus::{
        Focus, FocusScopeFrame, FocusableEntry, UiIntent, next_focus_after_build, resolve_focus,
    },
    font::{FontMetrics, MonospaceVga},
    id::{Id, hash_child_id},
    layout::{Alignment, Axis, Layout, Sizing, solve},
    primitives::{Rect, Vec2},
    retained::Retained,
    text::{
        TextLayout, TextRun, layout_text, text_color, text_fit_width, text_px, text_unwrapped_width,
    },
    theme::{Style, TextStyle, Theme},
};

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Response {
    pub id: Id,
    pub rect: Rect,
    pub focused: bool,
    pub activated: bool,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) enum ContainerKind {
    Flow,
    Panel,
}

#[derive(Clone, Debug)]
pub(crate) enum NodeKind {
    Container {
        kind: ContainerKind,
        style: Option<Style>,
    },
    Spacer,
    Text {
        runs: Vec<TextRun>,
        cfg: TextStyle,
    },
    Button {
        label: String,
        cfg: TextStyle,
    },
}

#[derive(Clone, Debug)]
pub(crate) struct Node {
    pub(crate) id: Id,
    pub(crate) kind: NodeKind,
    pub(crate) layout: Layout,
    pub(crate) children: Vec<usize>,
    pub(crate) content_size: Vec2,
    pub(crate) size: Vec2,
    pub(crate) pos: Vec2,
    pub(crate) text_layout: Option<TextLayout>,
}

impl Node {
    pub(crate) fn pos_to_rect(&self) -> Rect {
        Rect::new(self.pos.x, self.pos.y, self.size.x, self.size.y)
    }
}

#[derive(Clone, Debug)]
pub(crate) struct ScopeFrame {
    pub(crate) id: Id,
    #[cfg(debug_assertions)]
    pub(crate) sibling_ids: std::collections::HashSet<Id>,
    pub(crate) next_child_index: u64,
}

pub struct Ui<'a, M: FontMetrics> {
    pub(crate) build: &'a mut FrameBuild<M>,
}

pub struct UiEngine<M: FontMetrics> {
    font: M,
    theme: Theme,
    surface_size: Vec2,
    scale: f32,
    focus: Option<Id>,
    prev_focusables: Vec<FocusableEntry>,
    retained: Retained,
}

impl UiEngine<MonospaceVga> {
    pub fn new() -> Self {
        Self::with_font(MonospaceVga)
    }
}

impl<M: FontMetrics> UiEngine<M> {
    pub fn with_font(font: M) -> Self {
        Self {
            font,
            theme: Theme::default(),
            surface_size: Vec2::new(800.0, 600.0),
            scale: 1.0,
            focus: None,
            prev_focusables: Vec::new(),
            retained: Retained::default(),
        }
    }

    pub fn set_surface_size(&mut self, width: f32, height: f32) {
        self.surface_size = Vec2::new(width, height);
    }

    pub fn set_scale(&mut self, scale: f32) {
        self.scale = scale.max(1.0);
    }

    pub fn theme(&self) -> Theme {
        self.theme
    }

    pub fn theme_mut(&mut self) -> &mut Theme {
        &mut self.theme
    }

    pub fn focus(&self) -> Option<Id> {
        self.focus
    }

    pub fn set_focus(&mut self, focus: Option<Id>) {
        self.focus = focus;
    }

    pub fn frame(
        &mut self,
        intents: &[UiIntent],
        root: impl FnOnce(&mut Ui<'_, M>),
    ) -> FrameOutput {
        self.frame_with_options(intents, root, false)
    }

    pub fn frame_with_options(
        &mut self,
        intents: &[UiIntent],
        root: impl FnOnce(&mut Ui<'_, M>),
        preserve_focus: bool,
    ) -> FrameOutput {
        self.retained.frame = self.retained.frame.saturating_add(1);
        let (resolved_focus, activate_fired) =
            resolve_focus(self.focus, &self.prev_focusables, intents);
        let last_rects: HashMap<Id, Rect> = self
            .retained
            .map
            .iter()
            .map(|(id, entry)| (*id, entry.last_rect))
            .collect();
        let mut build = FrameBuild::new(
            &self.font,
            self.theme,
            self.surface_size,
            self.scale,
            resolved_focus,
            activate_fired,
            last_rects,
        );
        {
            let mut ui = Ui { build: &mut build };
            root(&mut ui);
        }

        let FrameResult {
            output,
            focusables,
            nodes,
        } = build.finish();

        self.prev_focusables = focusables;
        if !preserve_focus {
            self.focus = next_focus_after_build(resolved_focus, &self.prev_focusables);
        }

        self.retained.map.clear();
        for node in nodes {
            self.retained.touch(node.id, node.pos_to_rect());
        }
        self.retained.prune();
        output
    }
}

pub(crate) struct FrameResult {
    pub(crate) output: FrameOutput,
    pub(crate) focusables: Vec<FocusableEntry>,
    pub(crate) nodes: Vec<Node>,
}

pub(crate) struct FrameBuild<M: FontMetrics> {
    pub(crate) font: *const M,
    pub(crate) theme: Theme,
    pub(crate) surface_size: Vec2,
    pub(crate) scale: f32,
    pub(crate) focus: Option<Id>,
    pub(crate) activate_fired: bool,
    pub(crate) last_rects: HashMap<Id, Rect>,
    pub(crate) nodes: Vec<Node>,
    pub(crate) node_stack: Vec<usize>,
    pub(crate) scope_stack: Vec<ScopeFrame>,
    pub(crate) focus_scope_stack: Vec<FocusScopeFrame>,
    pub(crate) focusables: Vec<FocusableEntry>,
    pub(crate) responses: Vec<Response>,
    pub(crate) rects: Vec<RectInstance>,
    pub(crate) glyphs: Vec<GlyphInstance>,
    pub(crate) draw_cmds: Vec<DrawCmd>,
}

impl<M: FontMetrics> FrameBuild<M> {
    pub(crate) fn new(
        font: &M,
        theme: Theme,
        surface_size: Vec2,
        scale: f32,
        focus: Option<Id>,
        activate_fired: bool,
        last_rects: HashMap<Id, Rect>,
    ) -> Self {
        let mut build = Self {
            font: font as *const M,
            theme,
            surface_size,
            scale,
            focus,
            activate_fired,
            last_rects,
            nodes: Vec::new(),
            node_stack: Vec::new(),
            scope_stack: Vec::new(),
            focus_scope_stack: Vec::new(),
            focusables: Vec::new(),
            responses: Vec::new(),
            rects: Vec::new(),
            glyphs: Vec::new(),
            draw_cmds: Vec::new(),
        };
        build.nodes.push(Node {
            id: crate::id::ROOT_SCOPE_ID,
            kind: NodeKind::Container {
                kind: ContainerKind::Flow,
                style: None,
            },
            layout: Layout::new().column().grow(),
            children: Vec::new(),
            content_size: surface_size,
            size: surface_size,
            pos: Vec2::zero(),
            text_layout: None,
        });
        build.node_stack.push(0);
        build.scope_stack.push(ScopeFrame {
            id: crate::id::ROOT_SCOPE_ID,
            #[cfg(debug_assertions)]
            sibling_ids: std::collections::HashSet::new(),
            next_child_index: 0,
        });
        build.focus_scope_stack.push(FocusScopeFrame {
            id: crate::id::ROOT_SCOPE_ID,
            mode: Focus::Linear,
        });
        build
    }

    pub(crate) fn current_scope_id(&self) -> Id {
        self.scope_stack
            .last()
            .map(|scope| scope.id)
            .unwrap_or(crate::id::ROOT_SCOPE_ID)
    }

    pub(crate) fn alloc_child_id<T: Hash>(&mut self, key: Option<T>) -> Id {
        let parent = self.current_scope_id();
        let scope = self
            .scope_stack
            .last_mut()
            .expect("root scope frame must exist");
        let local_index = scope.next_child_index;
        scope.next_child_index += 1;
        let child_id = match key {
            Some(key) => hash_child_id(parent, key),
            None => hash_child_id(parent, local_index),
        };
        #[cfg(debug_assertions)]
        {
            let inserted = scope.sibling_ids.insert(child_id);
            assert!(inserted, "duplicate sibling id: {child_id:016x}");
        }
        child_id
    }

    pub(crate) fn font(&self) -> &M {
        unsafe { &*self.font }
    }

    pub(crate) fn push_node(&mut self, node: Node) -> usize {
        let index = self.nodes.len();
        if let Some(&parent_index) = self.node_stack.last() {
            self.nodes[parent_index].children.push(index);
        }
        self.nodes.push(node);
        index
    }

    pub(crate) fn begin_flow_container(&mut self, layout: Layout, style: Option<Style>) -> usize {
        let node_id = self.alloc_child_id::<u64>(None);
        let node_index = self.push_node(Node {
            id: node_id,
            kind: NodeKind::Container {
                kind: ContainerKind::Flow,
                style,
            },
            layout,
            children: Vec::new(),
            content_size: Vec2::zero(),
            size: Vec2::zero(),
            pos: Vec2::zero(),
            text_layout: None,
        });
        self.node_stack.push(node_index);
        node_index
    }

    pub(crate) fn begin_panel(&mut self, style: Style) -> usize {
        let node_id = self.alloc_child_id::<u64>(None);
        let layout = Layout::new()
            .column()
            .pad(style.pad.unwrap_or(self.theme.pad))
            .gap(style.gap.unwrap_or(self.theme.gap));
        let node_index = self.push_node(Node {
            id: node_id,
            kind: NodeKind::Container {
                kind: ContainerKind::Panel,
                style: Some(style),
            },
            layout,
            children: Vec::new(),
            content_size: Vec2::zero(),
            size: Vec2::zero(),
            pos: Vec2::zero(),
            text_layout: None,
        });
        self.node_stack.push(node_index);
        node_index
    }

    pub(crate) fn end_panel(&mut self) {
        let _ = self.node_stack.pop();
    }

    pub(crate) fn push_leaf_node(&mut self, kind: NodeKind, layout: Layout) -> usize {
        let node_id = self.alloc_child_id::<u64>(None);
        let node = Node {
            id: node_id,
            kind,
            layout,
            children: Vec::new(),
            content_size: Vec2::zero(),
            size: Vec2::zero(),
            pos: Vec2::zero(),
            text_layout: None,
        };
        self.push_node(node)
    }

    pub(crate) fn push_button(&mut self, key: &str, label: &str, cfg: TextStyle) -> Response {
        let node_id = self.alloc_child_id(Some(key));
        let layout = Layout::new().row().pad(self.theme.pad).gap(self.theme.gap);
        let node = Node {
            id: node_id,
            kind: NodeKind::Button {
                label: label.to_string(),
                cfg,
            },
            layout,
            children: Vec::new(),
            content_size: Vec2::zero(),
            size: Vec2::zero(),
            pos: Vec2::zero(),
            text_layout: None,
        };
        let node_index = self.push_node(node);
        let focused = self.focus == Some(node_id);
        let activated = focused && self.activate_fired;
        let rect = self.last_rects.get(&node_id).copied().unwrap_or_default();
        let scope = self
            .focus_scope_stack
            .last()
            .copied()
            .unwrap_or(FocusScopeFrame {
                id: crate::id::ROOT_SCOPE_ID,
                mode: Focus::Linear,
            });
        self.focusables.push(FocusableEntry {
            id: node_id,
            scope_id: scope.id,
            mode: scope.mode,
        });
        let response = Response {
            id: node_id,
            rect,
            focused,
            activated,
        };
        self.responses.push(response);
        let _ = node_index;
        response
    }

    pub(crate) fn finish(mut self) -> FrameResult {
        self.measure_content_width(0);
        self.resolve_width(0, self.surface_size.x);
        self.resolve_text_layouts_and_content_heights(0);
        self.resolve_content_heights(0);
        self.resolve_height(0, self.surface_size.y);
        self.position_node(0, Vec2::zero());
        self.emit_node(0);
        FrameResult {
            output: FrameOutput {
                rects: self.rects,
                glyphs: self.glyphs,
                draw_cmds: self.draw_cmds,
                responses: self.responses,
            },
            focusables: self.focusables,
            nodes: self.nodes,
        }
    }

    fn measure_content_width(&mut self, index: usize) -> f32 {
        let kind = self.nodes[index].kind.clone();
        let layout = self.nodes[index].layout;
        let children = self.nodes[index].children.clone();
        let content = match kind {
            NodeKind::Container {
                kind: ContainerKind::Flow,
                style,
            } => {
                let child_widths: Vec<f32> = children
                    .into_iter()
                    .map(|child| self.measure_content_width(child))
                    .collect();
                if child_widths.is_empty() {
                    layout.padding.horizontal()
                } else {
                    let inner = match layout.direction {
                        Axis::Row => {
                            child_widths.iter().sum::<f32>()
                                + layout.gap * (child_widths.len().saturating_sub(1) as f32)
                        }
                        Axis::Column => child_widths.into_iter().fold(0.0, f32::max),
                    };
                    inner
                        + layout.padding.horizontal()
                        + style.map_or(0.0, |s| s.border_px.unwrap_or(1.0) * 2.0)
                }
            }
            NodeKind::Container {
                kind: ContainerKind::Panel,
                style,
            } => {
                let child_widths: Vec<f32> = children
                    .into_iter()
                    .map(|child| self.measure_content_width(child))
                    .collect();
                let inner = child_widths.into_iter().fold(0.0, f32::max);
                inner
                    + layout.padding.horizontal()
                    + style.map_or(1.0, |style| style.border_px.unwrap_or(1.0) * 2.0)
            }
            NodeKind::Spacer => solve::resolve_child_base_size(layout.sizing[0], 0.0),
            NodeKind::Text { runs, cfg } => {
                let px = text_px(&cfg, self.theme, self.scale);
                text_fit_width(self.font(), &runs, px, cfg.wrap)
            }
            NodeKind::Button { label, cfg } => {
                let px = text_px(&cfg, self.theme, self.scale);
                let inner_width = text_unwrapped_width(
                    self.font(),
                    &[TextRun {
                        text: label,
                        color: text_color(&cfg, self.theme),
                    }],
                    px,
                );
                inner_width + self.theme.pad.horizontal() + self.theme.gap
            }
        };
        self.nodes[index].content_size.x = content;
        content
    }

    fn resolve_width(&mut self, index: usize, parent_inner: f32) {
        let layout = self.nodes[index].layout;
        let content = self.nodes[index].content_size.x;
        let width = solve::resolve_container_size(layout.sizing[0], parent_inner, content, 0.0);
        self.nodes[index].size.x = width;
        let inner_width = (width - layout.padding.horizontal()).max(0.0);

        let kind = self.nodes[index].kind.clone();
        let children = self.nodes[index].children.clone();
        match kind {
            NodeKind::Container {
                kind: ContainerKind::Flow,
                ..
            } => {
                let child_count = children.len();
                if child_count == 0 {
                    return;
                }

                let mut child_sizes: Vec<solve::ResizableChild> = children
                    .iter()
                    .map(|child_index| {
                        let child = &self.nodes[*child_index];
                        let (min, max) = solve::sizing_bounds(child.layout.sizing[0]);
                        let content = child.content_size.x;
                        let base = solve::resolve_child_base_size(child.layout.sizing[0], content);
                        let can_grow = matches!(child.layout.sizing[0], Sizing::Grow { .. });
                        solve::ResizableChild {
                            size: base,
                            min,
                            max,
                            can_grow,
                        }
                    })
                    .collect();

                if matches!(layout.direction, Axis::Row) {
                    let remaining = inner_width
                        - child_sizes.iter().map(|child| child.size).sum::<f32>()
                        - layout.gap * child_count.saturating_sub(1) as f32;
                    if remaining > crate::primitives::EPS {
                        solve::grow_children_smallest_first(&mut child_sizes, remaining);
                    } else if remaining < -crate::primitives::EPS {
                        solve::shrink_children_largest_first(&mut child_sizes, remaining);
                    }
                    for (child_index, child_size) in children.iter().zip(child_sizes.iter()) {
                        self.nodes[*child_index].size.x = child_size.size;
                        self.resolve_width(*child_index, child_size.size);
                    }
                } else {
                    for child_index in children {
                        let child = &self.nodes[child_index];
                        let child_width = solve::resolve_container_size(
                            child.layout.sizing[0],
                            inner_width,
                            child.content_size.x,
                            0.0,
                        );
                        self.nodes[child_index].size.x = child_width;
                        self.resolve_width(child_index, child_width);
                    }
                }
            }
            NodeKind::Container {
                kind: ContainerKind::Panel,
                style: _style,
            } => {
                if children.is_empty() {
                    return;
                }
                for child_index in children {
                    let child = &self.nodes[child_index];
                    let child_width = solve::resolve_container_size(
                        child.layout.sizing[0],
                        inner_width,
                        child.content_size.x,
                        0.0,
                    );
                    self.nodes[child_index].size.x = child_width;
                    self.resolve_width(child_index, child_width);
                }
            }
            NodeKind::Spacer => {}
            NodeKind::Text { runs, cfg } => {
                let inner = width.max(0.0);
                let layout = layout_text(self.font(), &runs, &cfg, self.theme, self.scale, inner);
                self.nodes[index].text_layout = Some(layout);
            }
            NodeKind::Button { label, cfg } => {
                let inner = (width - layout.padding.horizontal() - layout.gap).max(0.0);
                let text_layout = layout_text(
                    self.font(),
                    &[TextRun {
                        text: label,
                        color: text_color(&cfg, self.theme),
                    }],
                    &cfg,
                    self.theme,
                    self.scale,
                    inner,
                );
                let content_height = text_layout.height();
                self.nodes[index].text_layout = Some(text_layout);
                self.nodes[index].content_size.y =
                    content_height + self.theme.pad.vertical() + self.theme.gap;
            }
        }
    }

    fn resolve_text_layouts_and_content_heights(&mut self, index: usize) {
        match &self.nodes[index].kind.clone() {
            NodeKind::Container { .. } => {
                for child in self.nodes[index].children.clone() {
                    self.resolve_text_layouts_and_content_heights(child);
                }
            }
            NodeKind::Spacer => {}
            NodeKind::Text { .. } => {
                if let Some(layout) = self.nodes[index].text_layout.clone() {
                    self.nodes[index].content_size.y = layout.height();
                }
            }
            NodeKind::Button { .. } => {
                if let Some(layout) = self.nodes[index].text_layout.clone() {
                    let outer = layout.height() + self.nodes[index].layout.padding.vertical() + 2.0;
                    self.nodes[index].content_size.y = outer;
                }
            }
        }
    }

    fn resolve_content_heights(&mut self, index: usize) -> f32 {
        let kind = self.nodes[index].kind.clone();
        let layout = self.nodes[index].layout;
        let children = self.nodes[index].children.clone();
        let content = match kind {
            NodeKind::Container {
                kind: ContainerKind::Flow,
                ..
            } => {
                let child_heights: Vec<f32> = children
                    .iter()
                    .map(|child| self.resolve_content_heights(*child))
                    .collect();
                if child_heights.is_empty() {
                    layout.padding.vertical()
                } else {
                    match layout.direction {
                        Axis::Row => {
                            child_heights.into_iter().fold(0.0, f32::max)
                                + layout.padding.vertical()
                        }
                        Axis::Column => {
                            child_heights.iter().sum::<f32>()
                                + layout.gap * (child_heights.len().saturating_sub(1) as f32)
                                + layout.padding.vertical()
                        }
                    }
                }
            }
            NodeKind::Container {
                kind: ContainerKind::Panel,
                style,
            } => {
                let child_heights: Vec<f32> = children
                    .iter()
                    .map(|child| self.resolve_content_heights(*child))
                    .collect();
                let border = style.map_or(1.0, |style| style.border_px.unwrap_or(1.0)) * 2.0;
                if child_heights.is_empty() {
                    layout.padding.vertical() + border
                } else {
                    child_heights.iter().sum::<f32>()
                        + layout.gap * (child_heights.len().saturating_sub(1) as f32)
                        + layout.padding.vertical()
                        + border
                }
            }
            NodeKind::Spacer => {
                solve::resolve_child_base_size(self.nodes[index].layout.sizing[1], 0.0)
            }
            NodeKind::Text { .. } | NodeKind::Button { .. } => self.nodes[index].content_size.y,
        };
        self.nodes[index].content_size.y = content;
        content
    }

    fn resolve_height(&mut self, index: usize, parent_inner: f32) {
        let layout = self.nodes[index].layout;
        let content = self.nodes[index].content_size.y;
        let height = solve::resolve_container_size(layout.sizing[1], parent_inner, content, 0.0);
        self.nodes[index].size.y = height;
        let inner_height = (height - layout.padding.vertical()).max(0.0);

        let kind = self.nodes[index].kind.clone();
        let children = self.nodes[index].children.clone();
        match kind {
            NodeKind::Container {
                kind: ContainerKind::Flow,
                ..
            } => {
                let child_count = children.len();
                if child_count == 0 {
                    return;
                }

                let mut child_sizes: Vec<solve::ResizableChild> = children
                    .iter()
                    .map(|child_index| {
                        let child = &self.nodes[*child_index];
                        let (min, max) = solve::sizing_bounds(child.layout.sizing[1]);
                        let content = child.content_size.y;
                        let base = solve::resolve_child_base_size(child.layout.sizing[1], content);
                        let can_grow = matches!(child.layout.sizing[1], Sizing::Grow { .. });
                        solve::ResizableChild {
                            size: base,
                            min,
                            max,
                            can_grow,
                        }
                    })
                    .collect();

                if matches!(layout.direction, Axis::Column) {
                    let remaining = inner_height
                        - child_sizes.iter().map(|child| child.size).sum::<f32>()
                        - layout.gap * child_count.saturating_sub(1) as f32;
                    if remaining > crate::primitives::EPS {
                        solve::grow_children_smallest_first(&mut child_sizes, remaining);
                    } else if remaining < -crate::primitives::EPS {
                        solve::shrink_children_largest_first(&mut child_sizes, remaining);
                    }
                    for (child_index, child_size) in children.iter().zip(child_sizes.iter()) {
                        self.nodes[*child_index].size.y = child_size.size;
                        self.resolve_height(*child_index, child_size.size);
                    }
                } else {
                    for child_index in children {
                        let child = &self.nodes[child_index];
                        let child_height = solve::resolve_container_size(
                            child.layout.sizing[1],
                            inner_height,
                            child.content_size.y,
                            0.0,
                        );
                        self.nodes[child_index].size.y = child_height;
                        self.resolve_height(child_index, child_height);
                    }
                }
            }
            NodeKind::Container {
                kind: ContainerKind::Panel,
                ..
            } => {
                for child_index in children {
                    let child = &self.nodes[child_index];
                    let child_height = solve::resolve_container_size(
                        child.layout.sizing[1],
                        inner_height,
                        child.content_size.y,
                        0.0,
                    );
                    self.nodes[child_index].size.y = child_height;
                    self.resolve_height(child_index, child_height);
                }
            }
            NodeKind::Spacer => {}
            NodeKind::Text { .. } | NodeKind::Button { .. } => {}
        }
    }

    fn position_node(&mut self, index: usize, origin: Vec2) {
        self.nodes[index].pos = origin;
        let layout = self.nodes[index].layout;
        let inner_origin = Vec2::new(
            origin.x + layout.padding.left,
            origin.y + layout.padding.top,
        );
        match self.nodes[index].kind.clone() {
            NodeKind::Container {
                kind: ContainerKind::Flow,
                ..
            } => match layout.direction {
                Axis::Row => {
                    let child_count = self.nodes[index].children.len();
                    let total_main = self.nodes[index]
                        .children
                        .iter()
                        .map(|child| self.nodes[*child].size.x)
                        .sum::<f32>()
                        + layout.gap * child_count.saturating_sub(1) as f32;
                    let leftover =
                        (self.nodes[index].size.x - layout.padding.horizontal() - total_main)
                            .max(0.0);
                    let main_offset = match layout.align.main {
                        Alignment::Start => 0.0,
                        Alignment::Center => leftover * 0.5,
                        Alignment::End => leftover,
                    };
                    let mut cursor_x = inner_origin.x + main_offset;
                    let inner_height =
                        (self.nodes[index].size.y - layout.padding.vertical()).max(0.0);
                    for child_index in self.nodes[index].children.clone() {
                        let child_height = self.nodes[child_index].size.y;
                        let child_y = match layout.align.cross {
                            Alignment::Start => inner_origin.y,
                            Alignment::Center => {
                                inner_origin.y + (inner_height - child_height).max(0.0) * 0.5
                            }
                            Alignment::End => {
                                inner_origin.y + (inner_height - child_height).max(0.0)
                            }
                        };
                        let child_origin = Vec2::new(cursor_x, child_y);
                        self.position_node(child_index, child_origin);
                        cursor_x += self.nodes[child_index].size.x + layout.gap;
                    }
                }
                Axis::Column => {
                    let child_count = self.nodes[index].children.len();
                    let total_main = self.nodes[index]
                        .children
                        .iter()
                        .map(|child| self.nodes[*child].size.y)
                        .sum::<f32>()
                        + layout.gap * child_count.saturating_sub(1) as f32;
                    let leftover =
                        (self.nodes[index].size.y - layout.padding.vertical() - total_main)
                            .max(0.0);
                    let main_offset = match layout.align.main {
                        Alignment::Start => 0.0,
                        Alignment::Center => leftover * 0.5,
                        Alignment::End => leftover,
                    };
                    let mut cursor_y = inner_origin.y + main_offset;
                    let inner_width =
                        (self.nodes[index].size.x - layout.padding.horizontal()).max(0.0);
                    for child_index in self.nodes[index].children.clone() {
                        let child_width = self.nodes[child_index].size.x;
                        let child_x = match layout.align.cross {
                            Alignment::Start => inner_origin.x,
                            Alignment::Center => {
                                inner_origin.x + (inner_width - child_width).max(0.0) * 0.5
                            }
                            Alignment::End => inner_origin.x + (inner_width - child_width).max(0.0),
                        };
                        let child_origin = Vec2::new(child_x, cursor_y);
                        self.position_node(child_index, child_origin);
                        cursor_y += self.nodes[child_index].size.y + layout.gap;
                    }
                }
            },
            NodeKind::Container {
                kind: ContainerKind::Panel,
                style: _style,
            } => {
                let inner_width = (self.nodes[index].size.x - layout.padding.horizontal()).max(0.0);
                let mut cursor_y = inner_origin.y;
                for child_index in self.nodes[index].children.clone() {
                    let child_width = self.nodes[child_index].size.x;
                    let child_x = inner_origin.x
                        + match layout.align.cross {
                            Alignment::Start => 0.0,
                            Alignment::Center => (inner_width - child_width).max(0.0) * 0.5,
                            Alignment::End => (inner_width - child_width).max(0.0),
                        };
                    let child_origin = Vec2::new(child_x, cursor_y);
                    self.position_node(child_index, child_origin);
                    cursor_y += self.nodes[child_index].size.y + layout.gap;
                }
            }
            NodeKind::Spacer => {}
            NodeKind::Text { .. } => {}
            NodeKind::Button { .. } => {}
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{Color, Layout, TextStyle, UiIntent};

    #[test]
    fn monospace_metrics_scale_and_glyphs() {
        let font = MonospaceVga;
        assert_eq!(font.line_height(16.0), 16.0);
        assert_eq!(font.advance('A', 16.0), 8.0);
        assert!(font.glyph('A', 16.0).is_some());
        assert!(font.glyph(' ', 16.0).is_none());
    }

    #[test]
    fn text_wraps_to_width() {
        let mut engine = UiEngine::new();
        engine.set_surface_size(160.0, 120.0);
        let output = engine.frame(&[], |ui| {
            ui.column(Layout::new().column().fixed(160.0, 120.0), |ui| {
                ui.text(
                    "hello world",
                    TextStyle::default()
                        .px(16.0)
                        .wrap(true)
                        .color(Color::rgb(255, 255, 255)),
                );
            });
        });
        assert!(!output.glyphs.is_empty());
        assert!(
            output
                .draw_cmds
                .iter()
                .any(|cmd| cmd.program == od_core::DRAWCMD_PROGRAM_TEXT)
        );
    }

    #[test]
    fn button_focus_advances_and_activates() {
        let mut engine = UiEngine::new();
        engine.set_surface_size(240.0, 120.0);
        let first = engine.frame(&[], |ui| {
            ui.column(Layout::new().column().fixed(240.0, 120.0), |ui| {
                ui.button("resume", "Resume");
                ui.button("quit", "Quit");
            });
        });
        assert!(first.responses.iter().all(|response| !response.focused));
        assert_eq!(engine.focus(), Some(first.responses[0].id));

        let second = engine.frame(&[UiIntent::Activate], |ui| {
            ui.column(Layout::new().column().fixed(240.0, 120.0), |ui| {
                ui.button("resume", "Resume");
                ui.button("quit", "Quit");
            });
        });
        assert!(second.responses[0].focused);
        assert!(second.responses[0].activated);
    }
}
