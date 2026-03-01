#![warn(clippy::pedantic)]
#![allow(clippy::needless_pass_by_value)]

use bevy::prelude::*;
#[cfg(target_arch = "wasm32")]
use wasm_bindgen::prelude::*;

mod components;
mod domain;
mod resources;
pub use world_sim;

use domain::OpenDwarfPlugins;

#[cfg_attr(target_arch = "wasm32", wasm_bindgen)]
pub fn main() {
    App::new().add_plugins(OpenDwarfPlugins).run();
}
