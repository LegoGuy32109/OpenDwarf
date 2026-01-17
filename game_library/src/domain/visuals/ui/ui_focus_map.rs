use bevy::ecs::component::Component;
use bevy::ecs::entity::Entity;
use bevy::math::CompassOctant;

#[derive(Component, Debug)]
pub struct UiFocusMap<'a> {
    pub current_focus: Option<&'a UiNode<'a>>,
    focus_visible: bool,
    pub nodes: Vec<UiNode<'a>>,
}

impl<'a> Default for UiFocusMap<'a> {
    fn default() -> Self {
        Self {
            current_focus: None,
            focus_visible: false,
            nodes: vec![],
        }
    }
}

impl<'a> UiFocusMap<'a> {
    fn add_node(&mut self, node: UiNode<'a>) {
        self.nodes.push(node)
    }
}

#[derive(Debug)]
struct UiNode<'a> {
    pub neighbors: [Option<&'a UiNode<'a>>; 8],
    pub entity: Entity,
}

impl<'a> UiNode<'a> {
    fn get_next_node(&self, direction: CompassOctant) -> Option<&UiNode> {
        self.neighbors[direction.to_index()]
    }

    fn set_next_node(&mut self, direction: CompassOctant, node: &'a UiNode<'a>) {
        self.neighbors[direction.to_index()] = Some(node)
    }
}
