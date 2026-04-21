use bevy::prelude::*;

#[derive(Component, Debug, Clone, Copy)]
pub struct MapCoordinates {
    pub origin: IVec3,
    pub map_size: UVec3,
}

impl MapCoordinates {
    pub fn new(origin: IVec3, map_size: UVec3) -> Self {
        MapCoordinates { origin, map_size }
    }
}
