#![warn(clippy::pedantic)]
#![allow(clippy::needless_pass_by_value)]

use bevy::prelude::*;

mod components;
mod domain;
mod resources;
pub mod world_api;
pub mod world_bus;
pub mod world_core;

use domain::OpenDwarfPlugins;

fn main() {
    App::new().add_plugins(OpenDwarfPlugins).run();
}
