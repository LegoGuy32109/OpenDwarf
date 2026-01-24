use bevy::prelude::*;

mod components;
mod domain;
mod resources;

use domain::OpenDwarfPlugins;

fn main() {
    App::new().add_plugins(OpenDwarfPlugins).run();
}
