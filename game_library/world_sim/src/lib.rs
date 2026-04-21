pub mod bevy_app;
pub mod fov;
#[cfg(not(target_arch = "wasm32"))]
pub mod replay;
#[cfg(not(target_arch = "wasm32"))]
pub mod scenario;
pub mod world_api;
pub mod world_bus;
pub mod world_core;

pub mod prelude {
    pub use crate::bevy_app::PrimarySimulationEntityId;
    pub use crate::bevy_app::WorldCommandQueue;
    pub use crate::bevy_app::WorldSimApp;
    pub use crate::bevy_app::WorldSimDiagnostics;
    pub use crate::bevy_app::WorldSimSettings;
    pub use crate::bevy_app::WorldSimulationPlugin;
    pub use crate::bevy_app::WorldTickControl;
    pub use crate::bevy_app::WorldView;
    pub use crate::world_api::BlockType;
    pub use crate::world_api::Vec3i;
    pub use crate::world_api::Vec3u;
    pub use crate::world_api::WorldCommand;
    pub use crate::world_api::WorldSnapshot;
    pub use crate::world_api::WorldUpdate;
    pub use crate::world_core::TerrainConfig;
    pub use crate::world_core::WorldConfig;
}
