use bevy::ecs::entity::Entity;
use bevy::ecs::resource::Resource;
use bevy::ecs::system::Commands;

#[derive(Resource, Debug)]
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

    pub fn get_current_menu(&self) -> Option<Entity> {
        self.menu_stack.last().map(|e| e.clone())
    }

    pub fn push_new_menu(&mut self, new_menu: Entity) {
        // if let Some(current_menu) = self.get_current_menu() {
        //     // current_menu.shadow()
        // }
        self.menu_stack.push(new_menu);
    }

    pub fn pop_current_menu(&mut self, commands: &mut Commands) -> Option<Entity> {
        self.menu_stack.pop()
        // if let Some(closed_menu) = self.menu_queue.pop() {
        //     commands.entity(closed_menu).despawn()
        //     // closed_menu.despawn()
        // }
        // if let Some(prev_menu) = self.get_current_menu() {
        //     // prev_menu.focus()
        // }
    }

    pub fn clear_menu_queue(&mut self, commands: &mut Commands) {
        // for menu in &self.menu_stack {
        //     commands.entity(*menu).despawn()
        //     // menu.despawn()
        // }
        self.menu_stack = vec![];
    }
}
