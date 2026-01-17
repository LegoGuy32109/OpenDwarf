use bevy::ecs::component::Component;
use bevy::math::CompassOctant;

#[derive(Component, Debug)]
pub struct UiFocusMap<'a> {
    current_focus: Option<&'a UiNode<'a>>,
    focus_visible: bool,
}

#[derive(Debug)]
struct UiNode<'a> {
    pub neighbors: [Option<&'a UiNode<'a>>; 8],
}

impl Default for UiNode<'_> {
    fn default() -> Self {
        Self {
            neighbors: [None; 8],
        }
    }
}

impl<'a> UiNode<'_> {
    fn get_next_node(&self, direction: CompassOctant) -> Option<&UiNode> {
        return self.neighbors[direction.to_index()];
    }

    fn set_next_node(&mut self, direction: CompassOctant, node: &'a UiNode<'a>) {
        self.neighbors[direction.to_index()] = Some(node)
    }
}
