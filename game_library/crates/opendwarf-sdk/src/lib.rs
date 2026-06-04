//! Open Dwarf Rust SDK — the author-facing crate for writing mods that
//! compile to `wasm32-unknown-unknown` and run in the Open Dwarf wasm host.
//!
//! Mirrors the TypeScript `@opendwarf/sdk` surface. The same hook names,
//! the same types, the same sandbox — different language.
//!
//! ```ignore
//! use opendwarf_sdk::{export_mod, GameContext, Mod, ModManifest, Player};
//!
//! #[derive(Default)]
//! pub struct Welcome;
//!
//! impl Mod for Welcome {
//!     fn manifest(&self) -> ModManifest {
//!         ModManifest::new("welcome", "0.1.0")
//!     }
//!     fn on_player_join(&self, ctx: &mut GameContext, p: &Player) {
//!         ctx.broadcast(&format!("{} entered the fortress.", p.name));
//!     }
//! }
//!
//! export_mod!(Welcome);
//! ```

#![allow(clippy::missing_safety_doc)]

use serde::{Deserialize, Serialize};

// ---------- public types ----------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModManifest {
    pub name: String,
    pub version: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub author: Option<String>,
    #[serde(default)]
    pub dependencies: Vec<String>,
}

impl ModManifest {
    pub fn new(name: impl Into<String>, version: impl Into<String>) -> Self {
        Self {
            name: name.into(),
            version: version.into(),
            description: None,
            author: None,
            dependencies: Vec::new(),
        }
    }

    pub fn description(mut self, d: impl Into<String>) -> Self {
        self.description = Some(d.into());
        self
    }

    pub fn author(mut self, a: impl Into<String>) -> Self {
        self.author = Some(a.into());
        self
    }

    pub fn requires(mut self, dep: impl Into<String>) -> Self {
        self.dependencies.push(dep.into());
        self
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Position {
    pub x: f32,
    pub y: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlayerStats {
    pub hp: f32,
    pub hunger: f32,
    pub thirst: f32,
    pub energy: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Player {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub position: Position,
    #[serde(default)]
    pub stats: PlayerStats,
    #[serde(default, rename = "joinedAt")]
    pub joined_at: f64,
}

impl Default for Position {
    fn default() -> Self { Self { x: 0.0, y: 0.0 } }
}

impl Default for PlayerStats {
    fn default() -> Self {
        Self { hp: 100.0, hunger: 0.0, thirst: 0.0, energy: 100.0 }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GameMessage {
    pub text: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub from: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub kind: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum GameAction {
    Move { x: f32, y: f32 },
    Dig { x: f32, y: f32 },
    Attack { #[serde(rename = "targetId")] target_id: String },
    Custom { name: String, payload: serde_json::Value },
}

// ---------- host imports (ABI) ----------
//
// Returns from host that produce data pack `(ptr, len)` into a single u64:
//   high 32 bits = pointer in guest memory (the guest allocated it via
//                  _opendwarf_alloc before the host wrote into it)
//   low 32 bits  = length in bytes
// A return of 0 means "no data".

#[cfg(target_arch = "wasm32")]
unsafe extern "C" {
    fn __host_broadcast(ptr: *const u8, len: u32);
    fn __host_log(level: u32, ptr: *const u8, len: u32);
    fn __host_players_list() -> u64;
    fn __host_state_get() -> u64;
    fn __host_spawn(ptr: *const u8, len: u32) -> u64;
    fn __host_now() -> u64;
}

// Non-wasm builds (rust-analyzer, doctests) get stubs so the crate compiles.
#[cfg(not(target_arch = "wasm32"))]
mod host_stubs {
    pub unsafe fn __host_broadcast(_ptr: *const u8, _len: u32) {}
    pub unsafe fn __host_log(_level: u32, _ptr: *const u8, _len: u32) {}
    pub unsafe fn __host_players_list() -> u64 { 0 }
    pub unsafe fn __host_state_get() -> u64 { 0 }
    pub unsafe fn __host_spawn(_ptr: *const u8, _len: u32) -> u64 { 0 }
    pub unsafe fn __host_now() -> u64 { 0 }
}
#[cfg(not(target_arch = "wasm32"))]
use host_stubs::*;

// ---------- GameContext ----------

pub struct GameContext {
    _priv: (),
}

impl GameContext {
    pub fn broadcast(&mut self, msg: &str) {
        unsafe { __host_broadcast(msg.as_ptr(), msg.len() as u32) }
    }

    pub fn log_info(&mut self, msg: &str) {
        unsafe { __host_log(0, msg.as_ptr(), msg.len() as u32) }
    }

    pub fn log_warn(&mut self, msg: &str) {
        unsafe { __host_log(1, msg.as_ptr(), msg.len() as u32) }
    }

    pub fn log_error(&mut self, msg: &str) {
        unsafe { __host_log(2, msg.as_ptr(), msg.len() as u32) }
    }

    pub fn players(&mut self) -> Players<'_> { Players { _ctx: self } }
    pub fn world(&mut self) -> World<'_> { World { _ctx: self } }

    pub fn now(&self) -> u64 { unsafe { __host_now() } }
}

pub struct Players<'a> {
    _ctx: &'a mut GameContext,
}

impl<'a> Players<'a> {
    pub fn list(&self) -> Vec<Player> {
        let packed = unsafe { __host_players_list() };
        read_packed::<Vec<Player>>(packed).unwrap_or_default()
    }
}

pub struct World<'a> {
    _ctx: &'a mut GameContext,
}

#[derive(Serialize)]
struct SpawnArgs<'a> {
    kind: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    x: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    y: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    near: Option<String>,
}

pub struct SpawnBuilder<'a> {
    kind: &'a str,
    x: Option<f32>,
    y: Option<f32>,
    near: Option<String>,
}

impl<'a> World<'a> {
    pub fn spawn(&mut self, kind: &'a str) -> SpawnBuilder<'a> {
        SpawnBuilder { kind, x: None, y: None, near: None }
    }
}

impl<'a> SpawnBuilder<'a> {
    pub fn at(mut self, x: f32, y: f32) -> Self {
        self.x = Some(x);
        self.y = Some(y);
        self
    }

    pub fn near(mut self, id: impl Into<String>) -> Self {
        self.near = Some(id.into());
        self
    }

    pub fn fire(self) -> String {
        let args = SpawnArgs { kind: self.kind, x: self.x, y: self.y, near: self.near };
        let body = serde_json::to_vec(&args).unwrap_or_default();
        let packed = unsafe { __host_spawn(body.as_ptr(), body.len() as u32) };
        read_packed::<String>(packed).unwrap_or_default()
    }
}

// ---------- Mod trait ----------

pub trait Mod: Sync {
    fn manifest(&self) -> ModManifest;

    fn on_player_join(&self, _ctx: &mut GameContext, _player: &Player) {}
    fn on_player_leave(&self, _ctx: &mut GameContext, _player: &Player) {}
    fn on_tick(&self, _ctx: &mut GameContext) {}
    fn on_message(&self, _ctx: &mut GameContext, _msg: &GameMessage) {}
    fn on_action(&self, _ctx: &mut GameContext, _action: &GameAction) {}
}

// ---------- private helpers used by the macro ----------

#[doc(hidden)]
pub mod __private {
    use super::*;

    pub fn ctx() -> GameContext { GameContext { _priv: () } }

    pub fn read_json<T: for<'de> serde::Deserialize<'de>>(ptr: *const u8, len: u32) -> T {
        let slice = unsafe { core::slice::from_raw_parts(ptr, len as usize) };
        serde_json::from_slice(slice)
            .expect("opendwarf-sdk: host sent invalid JSON")
    }

    /// Serialize `value`, copy into guest memory at a freshly-allocated
    /// pointer, and return `(ptr, len)` packed as u64.
    pub fn write_packed<T: Serialize>(value: &T) -> u64 {
        let bytes = serde_json::to_vec(value).unwrap_or_default();
        write_bytes_packed(&bytes)
    }

    pub fn write_bytes_packed(bytes: &[u8]) -> u64 {
        let len = bytes.len();
        if len == 0 {
            return 0;
        }
        let ptr = super::_opendwarf_alloc(len as u32);
        unsafe {
            core::ptr::copy_nonoverlapping(bytes.as_ptr(), ptr, len);
        }
        ((ptr as u64) << 32) | (len as u64)
    }
}

fn read_packed<T: for<'de> Deserialize<'de>>(packed: u64) -> Option<T> {
    let ptr = (packed >> 32) as u32 as *const u8;
    let len = (packed & 0xFFFF_FFFF) as usize;
    if ptr.is_null() || len == 0 {
        return None;
    }
    let slice = unsafe { core::slice::from_raw_parts(ptr, len) };
    let result = serde_json::from_slice(slice).ok();
    // Free the buffer the host allocated for us.
    unsafe { _opendwarf_free(ptr as *mut u8, len as u32) };
    result
}

// ---------- memory exports ----------

#[unsafe(no_mangle)]
pub extern "C" fn _opendwarf_alloc(size: u32) -> *mut u8 {
    let mut buf: Vec<u8> = Vec::with_capacity(size as usize);
    let ptr = buf.as_mut_ptr();
    core::mem::forget(buf);
    ptr
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn _opendwarf_free(ptr: *mut u8, size: u32) {
    if ptr.is_null() || size == 0 { return; }
    let _ = unsafe { Vec::from_raw_parts(ptr, 0, size as usize) };
}

#[unsafe(no_mangle)]
pub extern "C" fn _opendwarf_abi_version() -> u32 { 1 }

// ---------- export_mod! macro ----------

/// Emit the wasm export entry points that bind a `Mod` impl to the
/// Open Dwarf ABI. The type must implement `Default`.
#[macro_export]
macro_rules! export_mod {
    ($t:ty) => {
        static __OPENDWARF_MOD: ::std::sync::OnceLock<$t> = ::std::sync::OnceLock::new();

        fn __opendwarf_instance() -> &'static $t {
            __OPENDWARF_MOD.get_or_init(<$t as ::core::default::Default>::default)
        }

        #[unsafe(no_mangle)]
        pub extern "C" fn _opendwarf_manifest() -> u64 {
            let m = $crate::Mod::manifest(__opendwarf_instance());
            $crate::__private::write_packed(&m)
        }

        #[unsafe(no_mangle)]
        pub extern "C" fn _opendwarf_on_player_join(ptr: *const u8, len: u32) {
            let player: $crate::Player = $crate::__private::read_json(ptr, len);
            let mut ctx = $crate::__private::ctx();
            $crate::Mod::on_player_join(__opendwarf_instance(), &mut ctx, &player);
        }

        #[unsafe(no_mangle)]
        pub extern "C" fn _opendwarf_on_player_leave(ptr: *const u8, len: u32) {
            let player: $crate::Player = $crate::__private::read_json(ptr, len);
            let mut ctx = $crate::__private::ctx();
            $crate::Mod::on_player_leave(__opendwarf_instance(), &mut ctx, &player);
        }

        #[unsafe(no_mangle)]
        pub extern "C" fn _opendwarf_on_tick() {
            let mut ctx = $crate::__private::ctx();
            $crate::Mod::on_tick(__opendwarf_instance(), &mut ctx);
        }

        #[unsafe(no_mangle)]
        pub extern "C" fn _opendwarf_on_message(ptr: *const u8, len: u32) {
            let msg: $crate::GameMessage = $crate::__private::read_json(ptr, len);
            let mut ctx = $crate::__private::ctx();
            $crate::Mod::on_message(__opendwarf_instance(), &mut ctx, &msg);
        }

        #[unsafe(no_mangle)]
        pub extern "C" fn _opendwarf_on_action(ptr: *const u8, len: u32) {
            let action: $crate::GameAction = $crate::__private::read_json(ptr, len);
            let mut ctx = $crate::__private::ctx();
            $crate::Mod::on_action(__opendwarf_instance(), &mut ctx, &action);
        }
    };
}
