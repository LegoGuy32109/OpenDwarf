use bevy::prelude::*;
use wasm_bindgen::prelude::*;

mod components;
mod domain;
use crate::domain::OpenDwarfPlugins;

#[wasm_bindgen]
pub fn main() {
    App::new().add_plugins(OpenDwarfPlugins).run();
}
