use bevy::state::state::States;

#[derive(States, Default, Clone, PartialEq, Eq, Hash, Debug)]
pub enum GameMode {
    #[default]
    World,
    InMenu,
    Typing,
}
