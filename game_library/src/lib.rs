use bevy::prelude::*;
use wasm_bindgen::prelude::*;

mod components;
mod domain;
use crate::domain::{GameMessage, MESSAGE_QUEUE, OpenDwarfPlugins};

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
