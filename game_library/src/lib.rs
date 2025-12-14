use bevy::prelude::*;
use wasm_bindgen::prelude::*;

mod components;
mod domain;
use crate::domain::{
  enqueue_messages_from_bytes,
  GameMessage,
  MESSAGE_QUEUE,
  OpenDwarfPlugins,
};

#[wasm_bindgen]
pub fn main() {
  App::new().add_plugins(OpenDwarfPlugins).run();
}

#[wasm_bindgen]
pub fn log_debug_message() {
  info!("Debug log triggered from JS via wasm_bindgen");
}

#[wasm_bindgen]
pub fn flip_player_sprite_y() {
  // enqueue request for the next frame so Bevy can safely mutate the world
  if let Ok(mut queue) = MESSAGE_QUEUE.lock() {
    queue.push_back(GameMessage::FlipPlayerSprite);
  }
}

#[wasm_bindgen]
pub fn send_game_bytes(bytes: &[u8]) {
  if let Err(err) = enqueue_messages_from_bytes(bytes) {
    warn!("Failed to enqueue game bytes: {err}");
  }
}
