mod intent;

use crate::{
    Axis, Color, FontMetrics, Layout, Padding, Sizing, Style, TextStyle, UiIntent,
    domain::ShellDomain, draw::FrameOutput, primitives::Vec2, settings::Settings,
    theme::TextAlign,
};

/// Keep shell titles/buttons on one line ("Open Dwarf", not "Open D\\nwarf").
const SHELL_MENU_MIN_WIDTH: f32 = 320.0;

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
    // Keep panel chrome padding at zero; the inner column owns spacing so width
    // math stays predictable across UI scales.
    let menu_style = Style::default()
        .bg(shell.ui.theme().panel_bg)
        .border_with(shell.ui.theme().border, 1.0)
        .pad(Padding::all(0.0))
        .gap(0.0);
    let mut shell_intents = Vec::new();
    let mut output = shell.ui.frame(ui_intents, |ui| {
        ui.column(
            Layout::new()
                .grow()
                .align(crate::Alignment::Center, crate::Alignment::Center),
            |ui| {
                ui.panel(menu_style, |ui| match page {
                    ShellPage::Root => build_root(ui, scale, &mut shell_intents),
                    ShellPage::Settings => build_settings(ui, scale, ui_scale, &mut shell_intents),
                });
            },
        );
    });

    inject_scrim(&mut output, sampled_size, scrim);
    (output, shell_intents)
}

fn shell_menu_column(scale: f32) -> Layout {
    // Min width tracks font scale so enlarged UI never forces the panel narrower
    // than its controls.
    let min_width = SHELL_MENU_MIN_WIDTH * scale.max(1.0);
    Layout::new()
        .pad(Padding::all(16.0 * scale.max(1.0)))
        .gap(12.0 * scale.max(1.0))
        .align(crate::Alignment::Start, crate::Alignment::Center)
        .sizing(
            Axis::Row,
            Sizing::Fit {
                min: min_width,
                max: f32::INFINITY,
            },
        )
}

fn build_root<M: FontMetrics>(
    ui: &mut crate::Ui<'_, M>,
    scale: f32,
    shell_intents: &mut Vec<ShellIntent>,
) {
    let title = TextStyle::default().align(TextAlign::Center).wrap(false);
    ui.column(shell_menu_column(scale), |ui| {
        ui.text("Open Dwarf", title);
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
    scale: f32,
    ui_scale: u8,
    shell_intents: &mut Vec<ShellIntent>,
) {
    let title = TextStyle::default().align(TextAlign::Center).wrap(false);
    let label = TextStyle::default().align(TextAlign::Center).wrap(false);
    let value = TextStyle::default().align(TextAlign::Center).wrap(false);
    // Vertical stack: title, label, then stepper. Avoids one wide horizontal row
    // that can outgrow a too-narrow panel background.
    ui.column(shell_menu_column(scale), |ui| {
        ui.text("Settings", title);
        ui.text("UI Scale", label);
        ui.row(
            Layout::new()
                .gap(10.0 * scale.max(1.0))
                .align(crate::Alignment::Start, crate::Alignment::Center),
            |ui| {
                if ui.button("scale_dec", "-").activated {
                    shell_intents.push(ShellIntent::ChangeSetting(SettingChange::UiScale(
                        ui_scale.saturating_sub(1),
                    )));
                }
                ui.text(&ui_scale.to_string(), value);
                if ui.button("scale_inc", "+").activated {
                    shell_intents.push(ShellIntent::ChangeSetting(SettingChange::UiScale(
                        ui_scale.saturating_add(1),
                    )));
                }
            },
        );
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
    fn settings_controls_stay_inside_panel() {
        for scale in [1.0_f32, 2.0_f32] {
            let mut shell = ShellDomain {
                ui: UiEngine::new(),
                open: true,
                nav: {
                    let mut nav = ShellNav::default();
                    nav.push(ShellPage::Settings);
                    nav
                },
            };
            let settings = Settings::default();
            let (output, _) =
                frame(&mut shell, Vec2::new(1280.0, 810.0), scale, &settings, &[]);

            let mut panels: Vec<_> = output
                .rects
                .iter()
                .filter(|rect| rect.size[0] > 32.0 && rect.size[0] < 900.0 && rect.size[1] > 32.0)
                .collect();
            panels.sort_by(|a, b| {
                b.size[0]
                    .partial_cmp(&a.size[0])
                    .unwrap_or(std::cmp::Ordering::Equal)
            });
            let panel = panels
                .first()
                .unwrap_or_else(|| panic!("settings panel rect at scale {scale}"));
            let left = panel.pos[0];
            let right = panel.pos[0] + panel.size[0];
            let top = panel.pos[1];
            let bottom = panel.pos[1] + panel.size[1];
            let min_width = SHELL_MENU_MIN_WIDTH * scale;

            assert!(
                panel.size[0] + 0.5 >= min_width,
                "scale {scale}: panel width {} should honor menu min width {min_width}",
                panel.size[0]
            );

            for glyph in &output.glyphs {
                let gx = glyph.pos[0];
                let gy = glyph.pos[1];
                assert!(
                    gx >= left - 1.0
                        && gx <= right + 1.0
                        && gy >= top - 1.0
                        && gy <= bottom + 1.0,
                    "scale {scale}: glyph at ({gx},{gy}) outside panel [{left},{top}]-[{right},{bottom}] (w={})",
                    panel.size[0]
                );
            }
        }
    }

    #[test]
    fn root_title_is_single_line() {
        let mut shell = ShellDomain {
            ui: UiEngine::new(),
            open: true,
            nav: ShellNav::default(),
        };
        let settings = Settings::default();
        let (output, _) = frame(&mut shell, Vec2::new(800.0, 600.0), 1.0, &settings, &[]);
        let mut y_counts: std::collections::BTreeMap<i32, usize> =
            std::collections::BTreeMap::new();
        for g in &output.glyphs {
            *y_counts.entry(g.pos[1].round() as i32).or_default() += 1;
        }
        let bands: Vec<_> = y_counts.into_iter().collect();
        assert!(!bands.is_empty(), "no glyphs");
        // "Open Dwarf" without the space glyph (~9 letters) must share one baseline.
        let first_text = bands.iter().find(|(_, c)| *c >= 4).expect("title band");
        assert!(
            first_text.1 >= 8,
            "expected Open Dwarf on one line, first band y={} count={} bands={:?}",
            first_text.0,
            first_text.1,
            bands
        );
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
