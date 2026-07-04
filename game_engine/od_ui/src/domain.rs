use od_core::{DrawCmd, GlyphInstance, RectInstance};

use crate::{
    draw::FrameOutput,
    font::{FontMetrics, MonospaceVga},
    input::{DecodedInput, InputState},
    primitives::Vec2,
    router::{HostEffect, route},
    settings::Settings,
    shell::{self, ShellIntent, ShellNav, ShellPage},
    ui::UiEngine,
};

const RECT_CAPACITY: usize = 64;
const GLYPH_CAPACITY: usize = 128;
const DRAWCMD_CAPACITY: usize = 16;

pub struct ShellDomain<M: FontMetrics> {
    pub ui: UiEngine<M>,
    pub open: bool,
    pub nav: ShellNav,
}

pub struct SessionDomain<M: FontMetrics> {
    pub ui: UiEngine<M>,
}

#[derive(Debug)]
pub struct FrameOut {
    pub draw_list_count: u32,
    pub host_effects: Vec<HostEffect>,
}

pub struct Engine<M: FontMetrics> {
    pub shell: ShellDomain<M>,
    pub session: SessionDomain<M>,
    settings: Settings,
    input_state: InputState,
    prev_shell_open: bool,
    rects: Vec<RectInstance>,
    glyphs: Vec<GlyphInstance>,
    draw_cmds: Vec<DrawCmd>,
    dropped_rects: u32,
    dropped_glyphs: u32,
    dropped_draw_cmds: u32,
}

impl Engine<MonospaceVga> {
    pub fn new() -> Self {
        Self::with_font(MonospaceVga)
    }
}

impl<M: FontMetrics + Clone> Engine<M> {
    pub fn with_font(font: M) -> Self {
        let settings = Settings::default();
        let shell = ShellDomain {
            ui: UiEngine::with_font(font.clone()),
            open: false,
            nav: ShellNav::default(),
        };
        let session = SessionDomain {
            ui: UiEngine::with_font(font),
        };
        Self {
            shell,
            session,
            settings,
            input_state: InputState::default(),
            prev_shell_open: false,
            rects: vec![RectInstance::default(); RECT_CAPACITY],
            glyphs: vec![GlyphInstance::default(); GLYPH_CAPACITY],
            draw_cmds: vec![DrawCmd::default(); DRAWCMD_CAPACITY],
            dropped_rects: 0,
            dropped_glyphs: 0,
            dropped_draw_cmds: 0,
        }
    }

    pub fn rect_ptr(&self) -> u32 {
        self.rects.as_ptr() as u32
    }

    pub fn rect_capacity(&self) -> u32 {
        self.rects.len() as u32
    }

    pub fn glyph_ptr(&self) -> u32 {
        self.glyphs.as_ptr() as u32
    }

    pub fn glyph_capacity(&self) -> u32 {
        self.glyphs.len() as u32
    }

    pub fn drawlist_ptr(&self) -> u32 {
        self.draw_cmds.as_ptr() as *const u8 as u32
    }

    pub fn drawlist_capacity(&self) -> u32 {
        self.draw_cmds.len() as u32
    }

    pub fn dropped_rects(&self) -> u32 {
        self.dropped_rects
    }

    pub fn dropped_glyphs(&self) -> u32 {
        self.dropped_glyphs
    }

    pub fn dropped_draw_cmds(&self) -> u32 {
        self.dropped_draw_cmds
    }

    pub fn hydrate_settings(&mut self, bytes: &[u8]) {
        if let Some(settings) = Settings::decode(bytes) {
            self.settings = settings;
        }
    }

    pub fn frame(&mut self, input_bytes: &[u8]) -> FrameOut {
        self.rects.fill(RectInstance::default());
        self.glyphs.fill(GlyphInstance::default());
        self.draw_cmds.fill(DrawCmd::default());
        self.dropped_rects = 0;
        self.dropped_glyphs = 0;
        self.dropped_draw_cmds = 0;

        let Some(decoded) = crate::input::decode(input_bytes) else {
            return FrameOut {
                draw_list_count: 0,
                host_effects: Vec::new(),
            };
        };

        let routed = route(&decoded, self.shell.open);
        let shell_open = self.shell.open;
        if self.prev_shell_open != shell_open {
            self.input_state.clear_repeats();
        }
        let filtered = DecodedInput {
            sampled: decoded.sampled,
            queue: decoded.queue,
            events: &routed.events,
        };
        let ui_intents = self.input_state.frame(&filtered, crate::Focus::Linear);

        let surface = Vec2::new(
            decoded.sampled.framebuffer_w as f32,
            decoded.sampled.framebuffer_h as f32,
        );
        let scale = self.settings.effective_scale(decoded.sampled.dpr);
        self.shell.ui.set_scale(scale);
        self.session.ui.set_scale(scale);

        let session_output = if shell_open {
            self.session
                .ui
                .frame_with_options(&[], |ui| build_session(ui), true)
        } else {
            self.session.ui.frame(&ui_intents, |ui| build_session(ui))
        };

        let mut host_effects = Vec::new();
        let mut shell_intents = routed.shell_intents;
        let shell_output = if shell_open {
            let (output, intents) =
                shell::frame(&mut self.shell, surface, scale, &self.settings, &ui_intents);
            shell_intents.extend(intents);
            Some(output)
        } else {
            None
        };

        for intent in shell_intents {
            self.apply_shell_intent(intent, &mut host_effects);
        }

        self.prev_shell_open = shell_open;
        self.merge_outputs(session_output, shell_output);
        FrameOut {
            draw_list_count: self.draw_cmds.len() as u32,
            host_effects,
        }
    }

    fn apply_shell_intent(&mut self, intent: ShellIntent, host_effects: &mut Vec<HostEffect>) {
        match intent {
            ShellIntent::Open => {
                self.shell.open = true;
                self.shell.nav.reset();
            }
            ShellIntent::Back => {
                if !self.shell.nav.pop() {
                    self.shell.open = false;
                }
            }
            ShellIntent::OpenSettings => {
                self.shell.nav.push(ShellPage::Settings);
            }
            ShellIntent::ChangeSetting(change) => {
                let changed = self.settings.apply_change(change);
                if changed {
                    host_effects.push(HostEffect::PersistSettings(self.settings.encode()));
                }
            }
            ShellIntent::LeaveGame => {
                host_effects.push(HostEffect::LeaveGame);
            }
        }
    }

    fn merge_outputs(&mut self, session_output: FrameOutput, shell_output: Option<FrameOutput>) {
        self.rects.clear();
        self.glyphs.clear();
        self.draw_cmds.clear();
        self.dropped_rects = 0;
        self.dropped_glyphs = 0;
        self.dropped_draw_cmds = 0;

        self.append_output(session_output);
        if let Some(shell_output) = shell_output {
            self.append_output(shell_output);
        }
    }

    fn append_output(&mut self, output: FrameOutput) {
        let rect_base = self.rects.len() as u32;
        let glyph_base = self.glyphs.len() as u32;
        for rect in output.rects {
            if self.rects.len() < self.rects.capacity() {
                self.rects.push(rect);
            } else {
                self.dropped_rects = self.dropped_rects.saturating_add(1);
            }
        }
        for glyph in output.glyphs {
            if self.glyphs.len() < self.glyphs.capacity() {
                self.glyphs.push(glyph);
            } else {
                self.dropped_glyphs = self.dropped_glyphs.saturating_add(1);
            }
        }
        for mut cmd in output.draw_cmds {
            if self.draw_cmds.len() < self.draw_cmds.capacity() {
                if cmd.program == od_core::DRAWCMD_PROGRAM_RECT {
                    cmd.instance_offset = cmd.instance_offset.saturating_add(rect_base);
                } else if cmd.program == od_core::DRAWCMD_PROGRAM_TEXT {
                    cmd.instance_offset = cmd.instance_offset.saturating_add(glyph_base);
                }
                self.draw_cmds.push(cmd);
            } else {
                self.dropped_draw_cmds = self.dropped_draw_cmds.saturating_add(1);
            }
        }
    }
}

fn build_session<M: FontMetrics>(ui: &mut crate::Ui<'_, M>) {
    ui.column(
        crate::Layout::new()
            .grow()
            .align(crate::Alignment::Center, crate::Alignment::Center),
        |ui| {
            ui.panel(
                crate::Style::default()
                    .bg(ui.build.theme.panel_bg)
                    .border_with(ui.build.theme.border, 1.0),
                |ui| {
                    ui.column(
                        crate::Layout::new().pad(crate::Padding::all(12.0)).gap(8.0),
                        |ui| {
                            ui.text("Session HUD", crate::TextStyle::default());
                            ui.text("Placeholder", crate::TextStyle::default());
                        },
                    );
                },
            );
        },
    );
}

#[cfg(test)]
mod tests {
    use od_core::{
        INPUT_KIND_KEY_DOWN, InputArena, InputEvent, InputQueueHeader, InputSampled, KeyCode,
    };

    use crate::{router, shell::ShellIntent};

    use super::*;

    fn arena_with(events: &[InputEvent], focused: bool) -> Vec<u8> {
        let mut arena = InputArena::default();
        arena.sampled = InputSampled {
            framebuffer_w: 800,
            framebuffer_h: 600,
            dpr: 1.0,
            dt_ms: 16.0,
            window_focused: u32::from(focused),
            pointer_x: 0.0,
            pointer_y: 0.0,
            buttons: 0,
        };
        arena.queue = InputQueueHeader {
            count: events.len() as u32,
            overflow: 0,
        };
        for (idx, event) in events.iter().copied().enumerate() {
            arena.events[idx] = event;
        }
        bytemuck::bytes_of(&arena).to_vec()
    }

    #[test]
    fn shell_escape_opens_and_closes() {
        let mut engine = Engine::new();
        let open = arena_with(
            &[InputEvent {
                kind: INPUT_KIND_KEY_DOWN,
                modifiers: 0,
                code: KeyCode::Escape as u16,
                value: 0,
            }],
            true,
        );
        let out = engine.frame(&open);
        assert!(out.draw_list_count > 0);
        assert!(engine.shell.open);
    }

    #[test]
    fn settings_encode_round_trips() {
        let settings = Settings {
            version: 1,
            ui_scale: 3,
        };
        let decoded = Settings::decode(&settings.encode()).expect("settings");
        assert_eq!(decoded.ui_scale, 3);
    }

    #[test]
    fn router_and_shell_intents_are_distinct() {
        let events = [InputEvent {
            kind: INPUT_KIND_KEY_DOWN,
            modifiers: 0,
            code: KeyCode::Escape as u16,
            value: 0,
        }];
        let decoded = DecodedInput {
            sampled: InputSampled::default(),
            queue: InputQueueHeader {
                count: 1,
                overflow: 0,
            },
            events: &events,
        };
        let routed = router::route(&decoded, false);
        assert_eq!(routed.shell_intents, vec![ShellIntent::Open]);
    }
}
