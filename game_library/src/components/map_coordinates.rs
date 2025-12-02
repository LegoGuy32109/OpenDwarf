use bevy::prelude::*;

#[derive(Component, Debug)]
pub struct MapCoordinates {
    origin: IVec3,
    map_size: UVec3,
}

impl MapCoordinates {
    /// move these coordinates along this direction
    pub fn add_direction(&mut self, vec: IVec3) -> &mut Self {
        // switch y value of vec, easier to align UVecs with chunk index direction, but when adding
        // the world should be negative when going down, positive when going up the screen.
        self.origin += IVec3::new(vec.x, -vec.y, vec.z);
        self
    }

    pub fn new(origin: IVec3, map_size: UVec3) -> Self {
        MapCoordinates { origin, map_size }
    }

    /// convert internal map / world coordinates to tilemap indexed coordinates
    pub fn as_uvec2(&self) -> UVec2 {
        UVec2 {
            x: u32::try_from(self.origin.x + i32::try_from(self.map_size.x).unwrap() / 2).unwrap(),
            y: u32::try_from(self.origin.y + i32::try_from(self.map_size.y).unwrap() / 2).unwrap(),
        }
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
