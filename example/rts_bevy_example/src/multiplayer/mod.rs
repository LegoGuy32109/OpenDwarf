use bevy::ecs::schedule::common_conditions::resource_equals;
use bevy::prelude::*;

mod webrtc;

pub use webrtc::WebrtcManager;

#[derive(Resource, Clone, Copy, PartialEq, Eq)]
pub enum Multiplayer {
    Disabled,
    Enabled,
}

pub struct MultiplayerPlugin;

impl Plugin for MultiplayerPlugin {
    fn build(&self, app: &mut App) {
        app.add_systems(
            Update,
            (webrtc_process_actions, webrtc_poll_network)
                .run_if(resource_equals(Multiplayer::Enabled)),
        );
    }
}

fn webrtc_process_actions(mut webrtc: ResMut<WebrtcManager>) {
    webrtc.process_actions();
}

fn webrtc_poll_network(mut webrtc: ResMut<WebrtcManager>) {
    webrtc.poll_network();
}
