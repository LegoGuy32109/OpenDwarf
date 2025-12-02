use bevy::prelude::*;

pub mod components;
pub mod domain;

use crate::domain::OpenDwarfPlugins;

fn main() {
  App::new().add_plugins(OpenDwarfPlugins).run();
}
