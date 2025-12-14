use bevy::prelude::*;
use std::collections::VecDeque;
use std::sync::Mutex;

use super::visuals::Player;

// Simple message queue pushed from JS and consumed in the game loop
pub static MESSAGE_QUEUE: Mutex<VecDeque<GameMessage>> = Mutex::new(VecDeque::new());

#[derive(Debug)]
pub enum GameMessage {
    FlipPlayerSprite,
    Log(String),
}

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

pub mod protocol;
