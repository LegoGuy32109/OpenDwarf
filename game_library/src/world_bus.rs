use std::sync::mpsc::{Receiver, Sender, channel};

use crate::world_api::{WorldCommand, WorldUpdate};

pub trait WorldBus {
    fn subscribe(&mut self) -> Receiver<WorldUpdate>;
    fn publish(&mut self, update: WorldUpdate);
    fn send_command(&self, command: WorldCommand) -> Result<(), String>;
    fn drain_commands(&mut self) -> Vec<WorldCommand>;
}

#[derive(Debug)]
pub struct InProcessWorldBus {
    command_rx: Receiver<WorldCommand>,
    command_tx: Sender<WorldCommand>,
    subscribers: Vec<Sender<WorldUpdate>>,
}

impl Default for InProcessWorldBus {
    fn default() -> Self {
        let (command_tx, command_rx) = channel();
        Self {
            command_rx,
            command_tx,
            subscribers: Vec::new(),
        }
    }
}

impl WorldBus for InProcessWorldBus {
    fn subscribe(&mut self) -> Receiver<WorldUpdate> {
        let (tx, rx) = channel();
        self.subscribers.push(tx);
        rx
    }

    fn publish(&mut self, update: WorldUpdate) {
        self.subscribers
            .retain(|subscriber| subscriber.send(update.clone()).is_ok());
    }

    fn send_command(&self, command: WorldCommand) -> Result<(), String> {
        self.command_tx
            .send(command)
            .map_err(|err| format!("failed to send world command: {err}"))
    }

    fn drain_commands(&mut self) -> Vec<WorldCommand> {
        let mut commands = Vec::new();
        while let Ok(command) = self.command_rx.try_recv() {
            commands.push(command);
        }
        commands
    }
}

#[cfg(test)]
mod tests {
    use super::{InProcessWorldBus, WorldBus};
    use crate::world_api::{Vec3i, WorldCommand, WorldDelta, WorldUpdate};

    #[test]
    fn publish_reaches_subscriber() {
        let mut bus = InProcessWorldBus::default();
        let subscriber = bus.subscribe();

        bus.publish(WorldUpdate::Delta(WorldDelta {
            tick: 1,
            moved_entities: vec![],
        }));

        let update = subscriber.recv().expect("subscriber should receive update");
        match update {
            WorldUpdate::Delta(delta) => assert_eq!(delta.tick, 1),
            WorldUpdate::Snapshot(_) => panic!("expected delta"),
        }
    }

    #[test]
    fn commands_can_be_enqueued_and_drained() {
        let mut bus = InProcessWorldBus::default();
        bus.send_command(WorldCommand::MoveEntity {
            id: 42,
            direction: Vec3i::new(0, 1, 0),
        })
        .expect("command send should work");

        let commands = bus.drain_commands();
        assert_eq!(commands.len(), 1);
    }
}
