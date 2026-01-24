#![warn(clippy::pedantic)]
#![allow(clippy::needless_pass_by_value)]

use bevy::prelude::*;
#[cfg(target_arch = "wasm32")]
use wasm_bindgen::prelude::*;

mod components;
mod domain;
mod resources;

use domain::OpenDwarfPlugins;
#[cfg(target_arch = "wasm32")]
use domain::messaging::protocol::enqueue_messages_from_bytes;

#[cfg_attr(target_arch = "wasm32", wasm_bindgen)]
pub fn main() {
    App::new().add_plugins(OpenDwarfPlugins).run();
}

#[cfg_attr(target_arch = "wasm32", wasm_bindgen)]
#[cfg(target_arch = "wasm32")]
pub fn send_game_bytes(bytes: &[u8]) {
    if let Err(err) = enqueue_messages_from_bytes(bytes) {
        warn!("Failed to enqueue game bytes: {err}");
    }
}
