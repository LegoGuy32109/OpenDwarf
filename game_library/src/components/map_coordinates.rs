use bevy::prelude::*;

#[derive(Component, Debug)]
pub struct MapCoordinates {
    origin: IVec3,
    map_size: UVec3,
}

impl MapCoordinates {
    pub fn new(origin: IVec3, map_size: UVec3) -> Self {
        MapCoordinates { origin, map_size }
    }
}

impl Clone for MapCoordinates {
    fn clone(&self) -> Self {
        Self {
            origin: self.origin,
            map_size: self.map_size,
        }
    }
}
