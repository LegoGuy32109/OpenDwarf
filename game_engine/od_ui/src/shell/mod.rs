mod intent;

use crate::{
    Color, FontMetrics, Layout, Padding, Style, TextStyle, UiIntent, domain::ShellDomain,
    draw::FrameOutput, primitives::Vec2, settings::Settings, theme::TextAlign,
};

pub use intent::{SettingChange, ShellIntent};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ShellPage {
    Root,
    Settings,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ShellNav {
    stack: Vec<ShellPage>,
}

impl Default for ShellNav {
    fn default() -> Self {
        Self {
            stack: vec![ShellPage::Root],
        }
    }
}

impl ShellNav {
    pub fn current(&self) -> ShellPage {
        self.stack.last().copied().unwrap_or(ShellPage::Root)
    }

    pub fn reset(&mut self) {
        self.stack.clear();
        self.stack.push(ShellPage::Root);
    }

    pub fn push(&mut self, page: ShellPage) {
        self.stack.push(page);
    }

    pub fn pop(&mut self) -> bool {
        if self.stack.len() > 1 {
            let _ = self.stack.pop();
            true
        } else {
            false
        }
    }
}

pub fn frame<M: FontMetrics>(
    shell: &mut ShellDomain<M>,
    sampled_size: Vec2,
    scale: f32,
    settings: &Settings,
    ui_intents: &[UiIntent],
) -> (FrameOutput, Vec<ShellIntent>) {
    shell.ui.set_surface_size(sampled_size.x, sampled_size.y);
    shell.ui.set_scale(scale);
    let page = shell.nav.current();
    let ui_scale = settings.ui_scale;
    let scrim = shell.ui.theme().scrim;
    let menu_style = Style::default()
        .bg(shell.ui.theme().panel_bg)
        .border_with(shell.ui.theme().border, 1.0);
    let mut shell_intents = Vec::new();
    let mut output = shell.ui.frame(ui_intents, |ui| {
        ui.column(
            Layout::new()
                .grow()
                .align(crate::Alignment::Center, crate::Alignment::Center),
            |ui| {
                ui.panel(menu_style, |ui| match page {
                    ShellPage::Root => build_root(ui, &mut shell_intents),
                    ShellPage::Settings => build_settings(ui, ui_scale, &mut shell_intents),
                });
            },
        );
    });

    inject_scrim(&mut output, sampled_size, scrim);
    (output, shell_intents)
}

fn build_root<M: FontMetrics>(ui: &mut crate::Ui<'_, M>, shell_intents: &mut Vec<ShellIntent>) {
    ui.column(Layout::new().pad(Padding::all(8.0)).gap(6.0), |ui| {
        ui.text("Open Dwarf", TextStyle::default().align(TextAlign::Center));
        if ui.button("resume", "Resume").activated {
            shell_intents.push(ShellIntent::Back);
        }
        if ui.button("settings", "Settings").activated {
            shell_intents.push(ShellIntent::OpenSettings);
        }
        if ui.button("leave_game", "Leave Game").activated {
            shell_intents.push(ShellIntent::LeaveGame);
        }
    });
}

fn build_settings<M: FontMetrics>(
    ui: &mut crate::Ui<'_, M>,
    ui_scale: u8,
    shell_intents: &mut Vec<ShellIntent>,
) {
    ui.column(Layout::new().pad(Padding::all(8.0)).gap(6.0), |ui| {
        ui.text("Settings", TextStyle::default().align(TextAlign::Center));
        ui.row(Layout::new().gap(8.0), |ui| {
            ui.text("UI Scale", TextStyle::default());
            if ui.button("scale_dec", "-").activated {
                shell_intents.push(ShellIntent::ChangeSetting(SettingChange::UiScale(
                    ui_scale.saturating_sub(1),
                )));
            }
            ui.text(&ui_scale.to_string(), TextStyle::default());
            if ui.button("scale_inc", "+").activated {
                shell_intents.push(ShellIntent::ChangeSetting(SettingChange::UiScale(
                    ui_scale.saturating_add(1),
                )));
            }
        });
    });
}

fn inject_scrim(output: &mut FrameOutput, surface_size: Vec2, scrim: Color) {
    let rect_offset = output.rects.len() as u32;
    output.rects.push(od_core::RectInstance {
        pos: [0.0, 0.0],
        size: [surface_size.x, surface_size.y],
        tint: [
            f32::from(scrim.r) / 255.0,
            f32::from(scrim.g) / 255.0,
            f32::from(scrim.b) / 255.0,
        ],
        alpha: f32::from(scrim.a) / 255.0,
    });
    output.draw_cmds.insert(
        0,
        od_core::DrawCmd {
            program: od_core::DRAWCMD_PROGRAM_RECT,
            instance_offset: rect_offset,
            instance_count: 1,
            scissor_x: -1,
            scissor_y: -1,
            scissor_w: -1,
            scissor_h: -1,
            reserved: 0,
        },
    );
}

#[cfg(test)]
mod tests {
    use crate::{Settings, ShellDomain, UiEngine, UiIntent};

    use super::*;

    #[test]
    fn resume_button_emits_back_after_focus_is_established() {
        let mut shell = ShellDomain {
            ui: UiEngine::new(),
            open: true,
            nav: ShellNav::default(),
        };
        let settings = Settings::default();

        let _ = frame(&mut shell, Vec2::new(800.0, 600.0), 1.0, &settings, &[]);
        assert!(shell.ui.focus().is_some());

        let (_, intents) = frame(
            &mut shell,
            Vec2::new(800.0, 600.0),
            1.0,
            &settings,
            &[UiIntent::Activate],
        );
        assert!(intents.contains(&ShellIntent::Back));
    }

    #[test]
    fn settings_stepper_emits_scale_changes() {
        let mut shell = ShellDomain {
            ui: UiEngine::new(),
            open: true,
            nav: {
                let mut nav = ShellNav::default();
                nav.push(ShellPage::Settings);
                nav
            },
        };
        let settings = Settings {
            version: 1,
            ui_scale: 2,
        };

        let _ = frame(&mut shell, Vec2::new(800.0, 600.0), 1.0, &settings, &[]);
        let (_, intents) = frame(
            &mut shell,
            Vec2::new(800.0, 600.0),
            1.0,
            &settings,
            &[UiIntent::Activate],
        );
        assert!(intents.iter().any(|intent| matches!(
            intent,
            ShellIntent::ChangeSetting(SettingChange::UiScale(1))
        )));
    }

    #[test]
    fn preserve_focus_keeps_session_selection() {
        let mut engine = UiEngine::new();
        engine.set_surface_size(220.0, 120.0);
        let first = engine.frame(&[], |ui| {
            ui.column(crate::Layout::new().column().fixed(220.0, 120.0), |ui| {
                ui.button("first", "First");
                ui.button("second", "Second");
            });
        });
        let focus = engine.focus();
        assert_eq!(focus, Some(first.responses[0].id));

        let second = engine.frame_with_options(
            &[],
            |ui| {
                ui.column(crate::Layout::new().column().fixed(220.0, 120.0), |ui| {
                    ui.button("first", "First");
                    ui.button("second", "Second");
                });
            },
            true,
        );
        assert_eq!(focus, engine.focus());
        assert_eq!(second.responses[0].focused, true);
    }
}
