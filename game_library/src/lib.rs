use bevy::prelude::*;
use wasm_bindgen::prelude::*;

mod components;
mod domain;
mod resources;
use crate::domain::OpenDwarfPlugins;
use crate::domain::messaging::protocol::enqueue_messages_from_bytes;

#[wasm_bindgen]
pub fn main() {
    App::new().add_plugins(OpenDwarfPlugins).run();
}

#[wasm_bindgen]
pub fn send_game_bytes(bytes: &[u8]) {
    if let Err(err) = enqueue_messages_from_bytes(bytes) {
        warn!("Failed to enqueue game bytes: {err}");
    }
}
