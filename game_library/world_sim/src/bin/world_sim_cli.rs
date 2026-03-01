use std::io::{self, BufRead, Write};

use world_sim::bevy_app::{WorldSimApp, WorldSimulationPlugin};
use world_sim::world_api::{Vec3i, WorldCommand, WorldUpdate};

fn main() {
    let mut app = WorldSimApp::new(WorldSimulationPlugin::default());
    let _ = app.drain_updates();
    let primary_entity_id = app.primary_entity_id();

    println!("world_sim_cli ready");
    if let Some(id) = primary_entity_id {
        println!("primary entity id={id}");
    } else {
        println!("no primary entity spawned");
    }
    println!(
        "commands: move <dx> <dy> <dz>, tick <count>, chunk <x> <y> <z> <loaded:0|1>, snapshot, updates, quit"
    );
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
                        let Some(id) = primary_entity_id else {
                            println!("no primary entity available");
                            print!("> ");
                            io::stdout().flush().expect("flush should work");
                            continue;
                        };
                        if let Err(err) = app.send_command(WorldCommand::MoveEntity {
                            id,
                            direction: Vec3i::new(dx, dy, dz),
                        }) {
                            println!("failed to enqueue move: {err}");
                        } else {
                            println!("queued move for entity {id}");
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
            "chunk" => {
                if parts.len() != 5 {
                    println!("usage: chunk <x> <y> <z> <loaded:0|1>");
                } else {
                    let parsed = (
                        parts[1].parse::<i32>(),
                        parts[2].parse::<i32>(),
                        parts[3].parse::<i32>(),
                        parts[4].parse::<u8>(),
                    );
                    if let (Ok(x), Ok(y), Ok(z), Ok(flag)) = parsed {
                        if flag > 1 {
                            println!("usage: chunk <x> <y> <z> <loaded:0|1>");
                        } else if let Err(err) = app.send_command(WorldCommand::SetChunkLoaded {
                            chunk: Vec3i::new(x, y, z),
                            loaded: flag == 1,
                        }) {
                            println!("failed to enqueue chunk command: {err}");
                        } else {
                            println!(
                                "queued chunk ({x}, {y}, {z}) => {}",
                                if flag == 1 { "loaded" } else { "unloaded" }
                            );
                        }
                    } else {
                        println!("usage: chunk <x> <y> <z> <loaded:0|1>");
                    }
                }
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
                        "entity {} @ ({}, {}, {}), facing_left={}, is_prone={}",
                        entity.id,
                        entity.position.x,
                        entity.position.y,
                        entity.position.z,
                        entity.facing_left,
                        entity.is_prone
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
