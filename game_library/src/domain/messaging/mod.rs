use bevy::prelude::*;
#[cfg(target_arch = "wasm32")]
use std::collections::VecDeque;
#[cfg(target_arch = "wasm32")]
use std::sync::Mutex;

use super::visuals::Player;

// Simple message queue pushed from JS and consumed in the game loop
#[cfg(target_arch = "wasm32")]
pub static MESSAGE_QUEUE: Mutex<VecDeque<GameMessage>> = Mutex::new(VecDeque::new());

#[derive(Debug)]
#[allow(dead_code)]
#[cfg(target_arch = "wasm32")]
pub enum GameMessage {
    FlipPlayerSprite,
    Log(String),
}

#[cfg(target_arch = "wasm32")]
pub fn process_game_messages(mut sprites: Query<&mut Sprite, With<Player>>) {
    let mut queue = MESSAGE_QUEUE.lock().expect("message queue poisoned");
    while let Some(message) = queue.pop_front() {
        match message {
            GameMessage::FlipPlayerSprite => {
                for mut sprite in &mut sprites {
                    sprite.flip_x = !sprite.flip_x;
                }
            }
            GameMessage::Log(msg) => {
                info!("Game message log: {msg}");
            }
        }
    }
}

#[cfg(not(target_arch = "wasm32"))]
pub fn process_game_messages(_sprites: Query<&mut Sprite, With<Player>>) {
    // No-op: JS-driven messages only exist on wasm builds.
}

#[cfg(target_arch = "wasm32")]
pub mod protocol;

pub mod webrtc;
