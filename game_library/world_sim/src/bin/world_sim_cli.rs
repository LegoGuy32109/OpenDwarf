use std::io::{self, BufRead, Write};

use world_sim::bevy_app::{WorldSimApp, WorldSimulationPlugin};
use world_sim::world_api::{Vec3i, WorldCommand, WorldUpdate};

fn main() {
    let mut app = WorldSimApp::new(WorldSimulationPlugin::default());
    let _ = app.drain_updates();

    println!("world_sim_cli ready");
    println!("commands: move <dx> <dy> <dz>, tick <count>, snapshot, updates, quit");
    print!("> ");
    io::stdout().flush().expect("flush should work");

    let stdin = io::stdin();
    for line in stdin.lock().lines() {
        let Ok(line) = line else {
            break;
        };
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.is_empty() {
            print!("> ");
            io::stdout().flush().expect("flush should work");
            continue;
        }

        match parts[0] {
            "move" => {
                if parts.len() != 4 {
                    println!("usage: move <dx> <dy> <dz>");
                } else {
                    let parsed = (
                        parts[1].parse::<i32>(),
                        parts[2].parse::<i32>(),
                        parts[3].parse::<i32>(),
                    );
                    if let (Ok(dx), Ok(dy), Ok(dz)) = parsed {
                        if let Err(err) = app.send_command(WorldCommand::MoveEntity {
                            id: 1,
                            direction: Vec3i::new(dx, dy, dz),
                        }) {
                            println!("failed to enqueue move: {err}");
                        } else {
                            println!("queued move for entity 1");
                        }
                    } else {
                        println!("usage: move <dx> <dy> <dz>");
                    }
                }
            }
            "tick" => {
                let count = if parts.len() > 1 {
                    parts[1].parse::<u32>().unwrap_or(1)
                } else {
                    1
                };
                if let Err(err) = app.send_command(WorldCommand::AdvanceTicks { count }) {
                    println!("failed to enqueue tick command: {err}");
                }
                app.step_ticks(1);
                println!("stepped simulation");
            }
            "snapshot" => {
                let snapshot = app.snapshot();
                println!(
                    "tick={} entities={} chunk_edge={} world_chunks=({}, {}, {})",
                    snapshot.tick,
                    snapshot.entities.len(),
                    snapshot.chunk_edge,
                    snapshot.world_chunks.x,
                    snapshot.world_chunks.y,
                    snapshot.world_chunks.z
                );
                for entity in snapshot.entities {
                    println!(
                        "entity {} @ ({}, {}, {})",
                        entity.id, entity.position.x, entity.position.y, entity.position.z
                    );
                }
            }
            "updates" => {
                let mut seen = 0usize;
                for update in app.drain_updates() {
                    match update {
                        WorldUpdate::Snapshot(snapshot) => println!(
                            "snapshot: tick={}, entities={}",
                            snapshot.tick,
                            snapshot.entities.len()
                        ),
                        WorldUpdate::Delta(delta) => println!(
                            "delta: tick={}, moved={}",
                            delta.tick,
                            delta.moved_entities.len()
                        ),
                    }
                    seen += 1;
                }
                if seen == 0 {
                    println!("no pending updates");
                }
            }
            "quit" | "exit" => break,
            _ => {
                println!("unknown command");
            }
        }

        print!("> ");
        io::stdout().flush().expect("flush should work");
    }
}
