use bevy::ecs::component::Component;
use bevy::ecs::entity::Entity;
use bevy::math::CompassOctant;

#[derive(Component, Debug, Default)]
pub struct UiFocusMap {
    pub current_focus: Option<Entity>,
    pub focus_visible: bool,
    pub nodes: Vec<UiNode>,
}

impl UiFocusMap {
    pub fn add_node(&mut self, entity: Entity) -> usize {
        self.nodes.push(UiNode {
            entity,
            neighbors: [None; 8],
        });
        self.nodes.len() - 1
    }

    pub fn link(&mut self, from_index: usize, direction: CompassOctant, to_index: usize) {
        let Some(target_entity) = self.nodes.get(to_index).map(|node| node.entity) else {
            return;
        };
        let Some(node) = self.nodes.get_mut(from_index) else {
            return;
        };
        node.neighbors[direction.to_index()] = Some(target_entity);
    }

    pub fn get_next_entity(&self, from: Entity, direction: CompassOctant) -> Option<Entity> {
        self.nodes
            .iter()
            .find(|node| node.entity == from)
            .and_then(|node| node.neighbors[direction.to_index()])
    }

    pub fn set_focus(&mut self, node_index: usize) {
        let Some(node) = self.nodes.get(node_index) else {
            return;
        };
        self.current_focus = Some(node.entity);
    }
}

#[derive(Debug)]
pub struct UiNode {
    pub neighbors: [Option<Entity>; 8],
    pub entity: Entity,
}
