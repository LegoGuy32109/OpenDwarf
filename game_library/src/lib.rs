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

#[cfg(target_arch = "wasm32")]
#[wasm_bindgen]
pub fn set_runtime_worker_script_url(worker_script_url: String) {
    domain::runtime_bridge::set_runtime_worker_script_url(worker_script_url);
}

#[cfg(target_arch = "wasm32")]
#[wasm_bindgen]
pub fn runtime_worker_main() {
    world_runtime::runtime_handle::runtime_worker_main();
}
