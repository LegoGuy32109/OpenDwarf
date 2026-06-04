//! examples/mods/welcome (Rust edition) — line-for-line analogue of
//! examples/mods/welcome/mod.ts, compiled to WebAssembly.
//!
//! Build:
//!   cargo build --target wasm32-unknown-unknown --release \
//!     --manifest-path game_library/crates/opendwarf-welcome/Cargo.toml
//!
//! Output:
//!   game_library/target/wasm32-unknown-unknown/release/opendwarf_welcome.wasm
//!
//! Copy or symlink the .wasm into the mods directory the server scans
//! (default: examples/mods/).

use opendwarf_sdk::{export_mod, GameContext, GameMessage, Mod, ModManifest, Player};

#[derive(Default)]
pub struct Welcome;

impl Mod for Welcome {
    fn manifest(&self) -> ModManifest {
        ModManifest::new("welcome-rs", "0.1.0")
            .description("Greet players on join and auto-feed hungry dwarves. (Rust)")
            .author("Open Dwarf examples")
    }

    fn on_player_join(&self, ctx: &mut GameContext, player: &Player) {
        ctx.broadcast(&format!("{} entered the fortress.", player.name));
        ctx.log_info(&format!("hello {}", player.name));
    }

    fn on_player_leave(&self, ctx: &mut GameContext, player: &Player) {
        ctx.broadcast(&format!("{} departed.", player.name));
    }

    fn on_tick(&self, ctx: &mut GameContext) {
        for player in ctx.players().list() {
            if player.stats.hunger > 80.0 {
                ctx.world().spawn("item").near(player.id.clone()).fire();
                ctx.log_info(&format!("fed {}", player.name));
            }
        }
    }

    fn on_message(&self, ctx: &mut GameContext, msg: &GameMessage) {
        if msg.text == "/hello" {
            ctx.broadcast("Hello to you too!");
        }
    }
}

export_mod!(Welcome);
