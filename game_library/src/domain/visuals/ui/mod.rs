use super::visual_utils::{color_from_hex, color_from_hex_alpha};
use bevy::prelude::*;

pub fn something(mut commands: Commands) {
    let ui_bundle = (
        Node {
            width: percent(100.),
            height: percent(100.),
            justify_content: JustifyContent::Center,
            align_items: AlignItems::Center,
            ..default()
        },
        children![(
            Node {
                width: px(100),
                height: px(100),
                border: UiRect::all(px(2)),
                justify_content: JustifyContent::Center,
                align_items: AlignItems::Center,
                ..default()
            },
            BorderColor::all(color_from_hex("#CFBFBB")),
            BackgroundColor(color_from_hex_alpha("#615950", 0.8)),
            children![(
                Text::new("Choice"),
                TextFont::default(),
                TextColor(Color::srgb(0.9, 0.9, 0.9)),
                TextShadow {
                    offset: vec2(2., 2.5),
                    ..default()
                },
            )]
        )],
    );

    commands.spawn(ui_bundle);
}
