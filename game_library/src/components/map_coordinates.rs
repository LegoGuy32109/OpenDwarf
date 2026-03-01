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

    /// convert internal map / world coordinates to tilemap indexed coordinates
    pub fn as_uvec2(&self) -> UVec2 {
        let half_x = i32::try_from(self.map_size.x)
            .expect("MapCoordinates::as_uvec2 map_size.x does not fit in i32")
            / 2;
        let half_y = i32::try_from(self.map_size.y)
            .expect("MapCoordinates::as_uvec2 map_size.y does not fit in i32")
            / 2;
        let x = self
            .origin
            .x
            .checked_add(half_x)
            .expect("MapCoordinates::as_uvec2 x overflowed while adding map center offset");
        let y = self
            .origin
            .y
            .checked_add(half_y)
            .expect("MapCoordinates::as_uvec2 y overflowed while adding map center offset");

        UVec2 {
            x: u32::try_from(x)
                .expect("MapCoordinates::as_uvec2 x is negative or exceeds u32 range"),
            y: u32::try_from(y)
                .expect("MapCoordinates::as_uvec2 y is negative or exceeds u32 range"),
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
