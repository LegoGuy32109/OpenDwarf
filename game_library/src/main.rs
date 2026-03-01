#![warn(clippy::pedantic)]
#![allow(clippy::needless_pass_by_value)]

use bevy::prelude::*;

mod components;
mod domain;
mod resources;

use domain::OpenDwarfPlugins;

fn main() {
    App::new().add_plugins(OpenDwarfPlugins).run();
}
