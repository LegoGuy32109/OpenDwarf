use bevy::ecs::entity::Entity;
use bevy::ecs::resource::Resource;
use bevy::ecs::system::Commands;

#[derive(Resource, Debug)]
pub struct PlayerFocusState {
    pub within_system_menu: bool,
    pub typing: bool,
    pub menu_queue: Vec<Entity>,
}

impl PlayerFocusState {
    pub fn can_move_in_world(&self) -> bool {
        !self.within_system_menu && !self.typing
    }

    pub fn get_current_menu(&self) -> Option<Entity> {
        self.menu_queue.last().map(|e| e.clone())
    }

    pub fn push_new_menu(&mut self, new_menu: Entity) {
        if let Some(current_menu) = self.get_current_menu() {
            // current_menu.shadow()
        }
        self.menu_queue.push(new_menu);
    }

    pub fn pop_current_menu(&mut self, commands: &mut Commands) {
        if let Some(closed_menu) = self.menu_queue.pop() {
            commands.entity(closed_menu).despawn()
            // closed_menu.despawn()
        }
        if let Some(prev_menu) = self.get_current_menu() {
            // prev_menu.focus()
        }
    }

    pub fn clear_menu_queue(&mut self, commands: &mut Commands) {
        for menu in &self.menu_queue {
            commands.entity(*menu).despawn()
            // menu.despawn()
        }
        self.menu_queue = vec![];
    }
}
