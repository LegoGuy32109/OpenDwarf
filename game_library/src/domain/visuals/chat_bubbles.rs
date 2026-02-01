use bevy::ecs::hierarchy::ChildOf;
use bevy::prelude::*;
use bevy::sprite::{Anchor, Text2d};
use bevy::text::{FontFeatureTag, FontFeatures, LineBreak, TextBounds, TextLayout, TextLayoutInfo};

use super::Player;

#[derive(Message, Debug, Clone)]
pub struct ChatBubbleEvent {
    pub message: String,
    pub style: ChatBubbleStyle,
    pub target: Option<Entity>,
}

impl ChatBubbleEvent {
    pub fn normal(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
            style: ChatBubbleStyle::Normal,
            target: None,
        }
    }

    pub fn emote(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
            style: ChatBubbleStyle::Emote,
            target: None,
        }
    }

    pub fn from_chat_input(input: &str) -> Self {
        if let Some(emote) = strip_emote_tag(input) {
            return Self::emote(emote);
        }
        Self::normal(input.to_string())
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ChatBubbleStyle {
    Normal,
    Emote,
}

pub struct ChatBubblePlugin;

impl Plugin for ChatBubblePlugin {
    fn build(&self, app: &mut App) {
        app.add_systems(
            Update,
            (
                chat_bubble_spawn_system,
                chat_bubble_fade_system,
                chat_bubble_layout_system,
                chat_bubble_stack_system,
            )
                .chain()
                .after(ApplyDeferred),
        )
        .add_message::<ChatBubbleEvent>();
    }
}

#[derive(Component)]
struct ChatBubble {
    spawned_at: f32,
    style: ChatBubbleStyle,
}

#[derive(Component)]
struct ChatBubbleBackground;

#[derive(Component)]
struct ChatBubbleText;

#[derive(Component, Default)]
struct ChatBubbleSize {
    width: f32,
    height: f32,
}

fn chat_bubble_spawn_system(
    mut commands: Commands,
    time: Res<Time>,
    player_query: Query<Entity, With<Player>>,
    mut bubble_events: MessageReader<ChatBubbleEvent>,
) {
    for event in bubble_events.read() {
        let target = if let Some(target) = event.target {
            Some(target)
        } else {
            player_query.single().ok()
        };

        let Some(target) = target else {
            continue;
        };

        spawn_chat_bubble(&mut commands, target, &event.message, event.style, &time);
    }
}

/// Fades chat bubbles in/out and despawns them when expired.
fn chat_bubble_fade_system(
    mut commands: Commands,
    time: Res<Time>,
    bubble_query: Query<(Entity, &ChatBubble)>,
    bubble_lookup: Query<&ChatBubble>,
    mut background_query: Query<(&ChildOf, &mut Sprite), With<ChatBubbleBackground>>,
    mut text_query: Query<(&ChildOf, &mut TextColor), With<ChatBubbleText>>,
) {
    let now = time.elapsed_secs();
    for (entity, bubble) in &bubble_query {
        if bubble_alpha(now - bubble.spawned_at).is_none() {
            commands.entity(entity).despawn();
        }
    }

    for (parent, mut sprite) in &mut background_query {
        let Ok(bubble) = bubble_lookup.get(parent.parent()) else {
            continue;
        };
        let age = now - bubble.spawned_at;
        let Some(alpha) = bubble_alpha(age) else {
            continue;
        };
        sprite.color = Color::srgba(
            CHAT_BUBBLE_BG_COLOR.0,
            CHAT_BUBBLE_BG_COLOR.1,
            CHAT_BUBBLE_BG_COLOR.2,
            CHAT_BUBBLE_BG_COLOR.3 * alpha,
        );
    }

    for (parent, mut color) in &mut text_query {
        let Ok(bubble) = bubble_lookup.get(parent.parent()) else {
            continue;
        };
        let age = now - bubble.spawned_at;
        let Some(alpha) = bubble_alpha(age) else {
            continue;
        };
        let target_alpha = match bubble.style {
            ChatBubbleStyle::Normal => CHAT_BUBBLE_TEXT_ALPHA,
            ChatBubbleStyle::Emote => CHAT_EMOTE_TEXT_ALPHA,
        };
        color.0 = Color::srgba(1.0, 1.0, 1.0, target_alpha * alpha);
    }
}

/// Updates chat bubble background size based on text layout info.
fn chat_bubble_layout_system(
    mut size_query: Query<&mut ChatBubbleSize>,
    text_query: Query<(&ChildOf, &TextLayoutInfo), With<ChatBubbleText>>,
    mut background_query: Query<(&ChildOf, &mut Sprite), With<ChatBubbleBackground>>,
) {
    for (parent, layout) in &text_query {
        let Ok(mut size) = size_query.get_mut(parent.parent()) else {
            continue;
        };
        let width = (layout.size.x + CHAT_BUBBLE_PADDING_X * 2.0)
            .max(CHAT_BUBBLE_MIN_WIDTH)
            .min(CHAT_BUBBLE_MAX_WIDTH + CHAT_BUBBLE_PADDING_X * 2.0);
        let height = (layout.size.y + CHAT_BUBBLE_PADDING_Y * 2.0).max(CHAT_BUBBLE_MIN_HEIGHT);
        size.width = width;
        size.height = height;
    }

    for (parent, mut sprite) in &mut background_query {
        let Ok(size) = size_query.get(parent.parent()) else {
            continue;
        };
        sprite.custom_size = Some(Vec2::new(size.width, size.height));
    }
}

/// Stacks chat bubbles above the player's sprite with newest at the bottom.
fn chat_bubble_stack_system(
    player_query: Query<Entity, With<Player>>,
    mut bubble_query: Query<(&ChatBubble, &ChatBubbleSize, &mut Transform, &ChildOf)>,
) {
    let Ok(player) = player_query.single() else {
        return;
    };

    let mut bubbles: Vec<_> = bubble_query
        .iter_mut()
        .filter(|(_, _, _, parent)| parent.parent() == player)
        .collect();

    bubbles.sort_by(|(a, _, _, _), (b, _, _, _)| {
        b.spawned_at
            .partial_cmp(&a.spawned_at)
            .unwrap_or(std::cmp::Ordering::Equal)
    });

    let mut offset_y = CHAT_BUBBLE_BASE_OFFSET_Y;
    for (_, size, mut transform, _) in bubbles {
        let height = size.height.max(CHAT_BUBBLE_MIN_HEIGHT);
        transform.translation = Vec3::new(0.0, offset_y + height * 0.5, CHAT_BUBBLE_Z);
        offset_y += height + CHAT_BUBBLE_STACK_SPACING;
    }
}

fn spawn_chat_bubble(
    commands: &mut Commands,
    target: Entity,
    message: &str,
    style: ChatBubbleStyle,
    time: &Time,
) {
    let bubble = commands
        .spawn((
            ChatBubble {
                spawned_at: time.elapsed_secs(),
                style,
            },
            ChatBubbleSize {
                width: CHAT_BUBBLE_MIN_WIDTH,
                height: CHAT_BUBBLE_MIN_HEIGHT,
            },
            Transform::default(),
            GlobalTransform::default(),
        ))
        .id();

    if style == ChatBubbleStyle::Normal {
        let background = commands
            .spawn((
                ChatBubbleBackground,
                Sprite {
                    color: Color::srgba(
                        CHAT_BUBBLE_BG_COLOR.0,
                        CHAT_BUBBLE_BG_COLOR.1,
                        CHAT_BUBBLE_BG_COLOR.2,
                        0.0,
                    ),
                    custom_size: Some(Vec2::new(CHAT_BUBBLE_MIN_WIDTH, CHAT_BUBBLE_MIN_HEIGHT)),
                    ..default()
                },
                Transform::default(),
                GlobalTransform::default(),
            ))
            .id();
        commands.entity(bubble).add_child(background);
    }

    let font_features = if style == ChatBubbleStyle::Emote {
        FontFeatures::builder()
            .set(FontFeatureTag::SLANT, CHAT_EMOTE_SLANT)
            .build()
    } else {
        FontFeatures::default()
    };

    let text = commands
        .spawn((
            ChatBubbleText,
            Text2d::new(message),
            TextFont {
                font_size: CHAT_BUBBLE_FONT_SIZE,
                font_features,
                ..default()
            },
            TextColor(Color::WHITE),
            TextLayout {
                linebreak: LineBreak::WordOrCharacter,
                justify: Justify::Center,
            },
            TextBounds::new_horizontal(CHAT_BUBBLE_MAX_WIDTH),
            Anchor::CENTER,
            Transform::from_translation(Vec3::new(0.0, 0.0, 0.0)),
        ))
        .id();

    commands.entity(bubble).add_child(text);
    commands.entity(target).add_child(bubble);
}

fn bubble_alpha(age: f32) -> Option<f32> {
    if age < 0.0 {
        return Some(0.0);
    }
    if age < CHAT_BUBBLE_FADE_IN_SECS {
        return Some(age / CHAT_BUBBLE_FADE_IN_SECS);
    }
    if age < CHAT_BUBBLE_VISIBLE_SECS {
        return Some(1.0);
    }
    let fade_out_age = age - CHAT_BUBBLE_VISIBLE_SECS;
    if fade_out_age < CHAT_BUBBLE_FADE_OUT_SECS {
        return Some(1.0 - fade_out_age / CHAT_BUBBLE_FADE_OUT_SECS);
    }
    None
}

fn strip_emote_tag(input: &str) -> Option<String> {
    let trimmed = input.trim();
    if !trimmed.starts_with("<i>") || !trimmed.ends_with("</i>") {
        return None;
    }
    let inner = &trimmed[3..trimmed.len() - 4];
    let inner = inner.trim();
    if inner.is_empty() {
        return None;
    }
    Some(inner.to_string())
}

const CHAT_BUBBLE_MAX_WIDTH: f32 = 200.0;
const CHAT_BUBBLE_MIN_WIDTH: f32 = 32.0;
const CHAT_BUBBLE_MIN_HEIGHT: f32 = 26.0;
const CHAT_BUBBLE_PADDING_X: f32 = 4.0;
const CHAT_BUBBLE_PADDING_Y: f32 = 2.0;
const CHAT_BUBBLE_FONT_SIZE: f32 = 14.0;
const CHAT_BUBBLE_BASE_OFFSET_Y: f32 = 30.0;
const CHAT_BUBBLE_STACK_SPACING: f32 = 6.0;
const CHAT_BUBBLE_FADE_IN_SECS: f32 = 0.2;
const CHAT_BUBBLE_VISIBLE_SECS: f32 = 5.0;
const CHAT_BUBBLE_FADE_OUT_SECS: f32 = 0.4;
const CHAT_BUBBLE_BG_COLOR: (f32, f32, f32, f32) = (0.1, 0.1, 0.1, 0.55);
const CHAT_BUBBLE_TEXT_ALPHA: f32 = 1.0;
const CHAT_EMOTE_TEXT_ALPHA: f32 = 0.9;
const CHAT_EMOTE_SLANT: u32 = 10;
const CHAT_BUBBLE_Z: f32 = 10.0;
