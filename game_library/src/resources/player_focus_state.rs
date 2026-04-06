use bevy::ecs::entity::Entity;
use bevy::ecs::resource::Resource;

#[derive(Resource, Debug, Default)]
pub struct PlayerFocusState {
    pub menu_stack: Vec<Entity>,
}

impl PlayerFocusState {
    pub fn is_menu_focused(&self, menu: Entity) -> bool {
        self.current_menu_index() == self.get_menu_index(menu)
    }

    pub fn get_menu_index(&self, target_menu: Entity) -> Option<usize> {
        self.menu_stack.iter().position(|&menu| menu == target_menu)
    }

    pub fn current_menu_index(&self) -> Option<usize> {
        if self.menu_stack.is_empty() {
            None
        } else {
            Some(self.menu_stack.len() - 1)
        }
    }

    pub fn push_new_menu(&mut self, new_menu: Entity) {
        self.menu_stack.push(new_menu);
    }

    pub fn pop_current_menu(&mut self) -> Option<Entity> {
        self.menu_stack.pop()
    }
}
