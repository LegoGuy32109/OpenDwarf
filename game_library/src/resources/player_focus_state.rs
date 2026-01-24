use bevy::ecs::entity::Entity;
use bevy::ecs::resource::Resource;

#[derive(Resource, Debug, Default)]
pub struct PlayerFocusState {
    pub within_system_menu: bool,
    pub typing: bool,
    pub menu_stack: Vec<Entity>,
}

impl PlayerFocusState {
    pub fn can_move_in_world(&self) -> bool {
        !self.within_system_menu && !self.typing
    }

    pub fn get_menu_index(&self, target_menu: Entity) -> Option<usize> {
        self.menu_stack.iter().position(|&menu| menu == target_menu)
    }

    // pub fn get_current_menu(&self) -> Option<Entity> {
    //     self.menu_stack.last().map(|e| e.clone())
    // }

    pub fn push_new_menu(&mut self, new_menu: Entity) {
        self.menu_stack.push(new_menu);
    }

    pub fn pop_current_menu(&mut self) -> Option<Entity> {
        self.menu_stack.pop()
    }

    // TODO: map this to Shift + Q or something
    // pub fn clear_menu_queue(&mut self) {
    //     self.menu_stack = vec![];
    // }
}
