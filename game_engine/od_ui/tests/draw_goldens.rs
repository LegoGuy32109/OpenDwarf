//! Native draw-hash goldens mirroring the seven browser checkpoints.
//!
//! Bless: `OD_BLESS_GOLDENS=1 cargo test -p od_ui --test draw_goldens`
//! (also via `deno task engine:bless-goldens-native`).

use std::collections::BTreeMap;
use std::fs;
use std::path::PathBuf;

use od_core::{
    INPUT_KIND_KEY_DOWN, INPUT_KIND_KEY_UP, INPUT_KIND_TEXT, InputArena, InputEvent,
    InputQueueHeader, InputSampled, KeyCode,
};
use od_ui::{DomainEngine, MonospaceVga};

type Engine = DomainEngine<MonospaceVga>;

const SURFACE_W: u32 = 1920;
const SURFACE_H: u32 = 1080;
const DT_MS: f32 = 16.0;

const CHECKPOINTS: [&str; 7] = [
    "boot_idle",
    "chat_open_empty",
    "chat_typed",
    "chat_submitted",
    "shell_root",
    "shell_settings",
    "shell_settings_scale",
];

fn goldens_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("goldens/draw_hash.json")
}

fn load_expected() -> BTreeMap<String, String> {
    let path = goldens_path();
    if !path.exists() {
        return BTreeMap::new();
    }
    let raw = fs::read_to_string(&path).expect("read goldens");
    serde_json::from_str(&raw).expect("parse goldens")
}

fn bless_expected(values: &BTreeMap<String, String>) {
    let path = goldens_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).expect("create goldens dir");
    }
    let raw = serde_json::to_string_pretty(values).expect("serialize goldens") + "\n";
    fs::write(&path, raw).expect("write goldens");
}

fn arena_with(events: &[InputEvent]) -> Vec<u8> {
    let mut arena = InputArena::default();
    arena.sampled = InputSampled {
        framebuffer_w: SURFACE_W,
        framebuffer_h: SURFACE_H,
        dpr: 1.0,
        dt_ms: DT_MS,
        window_focused: 1,
        pointer_x: 0.0,
        pointer_y: 0.0,
        buttons: 0,
    };
    arena.queue = InputQueueHeader {
        count: events.len() as u32,
        overflow: 0,
    };
    for (idx, event) in events.iter().copied().enumerate() {
        arena.events[idx] = event;
    }
    bytemuck::bytes_of(&arena).to_vec()
}

fn key_down(code: KeyCode) -> InputEvent {
    InputEvent {
        kind: INPUT_KIND_KEY_DOWN,
        modifiers: 0,
        code: code as u16,
        value: 0,
    }
}

fn key_up(code: KeyCode) -> InputEvent {
    InputEvent {
        kind: INPUT_KIND_KEY_UP,
        modifiers: 0,
        code: code as u16,
        value: 0,
    }
}

fn text_char(ch: char) -> InputEvent {
    InputEvent {
        kind: INPUT_KIND_TEXT,
        modifiers: 0,
        code: 0,
        value: u32::from(ch),
    }
}

fn press(code: KeyCode) -> Vec<InputEvent> {
    vec![key_down(code), key_up(code)]
}

fn idle_frame(engine: &mut Engine) {
    let _ = engine.frame(&arena_with(&[]));
}

fn step(engine: &mut Engine, events: &[InputEvent]) {
    let _ = engine.frame(&arena_with(events));
}

fn snapshot_allowlist(engine: &Engine) -> serde_json::Value {
    let snap: serde_json::Value =
        serde_json::from_str(&engine.debug_snapshot_json()).expect("snapshot json");
    serde_json::json!({
        "drawHash": snap["frame"]["drawHash"],
        "shell": {
            "open": snap["shell"]["open"],
            "page": snap["shell"]["page"],
        },
        "session": {
            "uiMode": snap["session"]["uiMode"],
            "chatDraft": snap["session"]["chatDraft"],
            "chatMessages": snap["session"]["chatMessages"],
        },
        "input": {
            "textCaptureActive": snap["session"]["uiMode"] == "chat",
        },
    })
}

fn run_checkpoint(name: &str) -> (String, serde_json::Value) {
    let mut engine = Engine::new();
    match name {
        "boot_idle" => {
            idle_frame(&mut engine);
        }
        "chat_open_empty" => {
            idle_frame(&mut engine);
            step(&mut engine, &press(KeyCode::KeyT));
            idle_frame(&mut engine);
        }
        "chat_typed" => {
            idle_frame(&mut engine);
            step(&mut engine, &press(KeyCode::KeyT));
            idle_frame(&mut engine);
            let mut events = Vec::new();
            for ch in "hello".chars() {
                events.push(text_char(ch));
            }
            step(&mut engine, &events);
            idle_frame(&mut engine);
        }
        "chat_submitted" => {
            idle_frame(&mut engine);
            step(&mut engine, &press(KeyCode::KeyT));
            idle_frame(&mut engine);
            let events: Vec<_> = "hello".chars().map(text_char).collect();
            step(&mut engine, &events);
            idle_frame(&mut engine);
            step(&mut engine, &press(KeyCode::Enter));
            idle_frame(&mut engine);
        }
        "shell_root" => {
            idle_frame(&mut engine);
            step(&mut engine, &press(KeyCode::Escape));
            idle_frame(&mut engine);
        }
        "shell_settings" => {
            idle_frame(&mut engine);
            step(&mut engine, &press(KeyCode::Escape));
            idle_frame(&mut engine); // establish focus on Resume
            step(&mut engine, &press(KeyCode::KeyK)); // FocusNext → Settings
            idle_frame(&mut engine);
            step(&mut engine, &press(KeyCode::Enter)); // Activate Settings
            idle_frame(&mut engine);
        }
        "shell_settings_scale" => {
            idle_frame(&mut engine);
            step(&mut engine, &press(KeyCode::Escape));
            idle_frame(&mut engine);
            step(&mut engine, &press(KeyCode::KeyK));
            idle_frame(&mut engine);
            step(&mut engine, &press(KeyCode::Enter));
            idle_frame(&mut engine); // settings page, focus scale_dec
            step(&mut engine, &press(KeyCode::KeyK)); // → scale_inc
            idle_frame(&mut engine);
            step(&mut engine, &press(KeyCode::Enter)); // ui_scale 1 → 2
            idle_frame(&mut engine);
        }
        other => panic!("unknown checkpoint {other}"),
    }
    let allow = snapshot_allowlist(&engine);
    let hash = allow["drawHash"]
        .as_str()
        .expect("drawHash string")
        .to_owned();
    (hash, allow)
}

#[test]
fn native_draw_hash_goldens() {
    let bless = std::env::var("OD_BLESS_GOLDENS").is_ok();
    let mut expected = load_expected();
    let mut allowlists = BTreeMap::new();

    for name in CHECKPOINTS {
        let (hash, allow) = run_checkpoint(name);
        allowlists.insert(name.to_owned(), allow.clone());
        if bless {
            expected.insert(name.to_owned(), hash);
        } else {
            let want = expected.get(name).unwrap_or_else(|| {
                panic!(
                    "missing golden for `{name}`; run `deno task engine:bless-goldens-native`"
                )
            });
            assert_eq!(
                &hash, want,
                "drawHash mismatch for `{name}`\nallowlist: {allow}"
            );
        }

        // Semantic allowlist sanity (always asserted).
        let shell = &allow["shell"];
        let session = &allow["session"];
        match name {
            "boot_idle" => {
                assert_eq!(shell["open"], false);
                assert_eq!(session["uiMode"], "world");
            }
            "chat_open_empty" => {
                assert_eq!(session["uiMode"], "chat");
                assert_eq!(session["chatDraft"], "");
                assert_eq!(allow["input"]["textCaptureActive"], true);
            }
            "chat_typed" => {
                assert_eq!(session["uiMode"], "chat");
                assert_eq!(session["chatDraft"], "hello");
            }
            "chat_submitted" => {
                assert_eq!(session["uiMode"], "world");
                assert_eq!(session["chatDraft"], "");
                assert!(session["chatMessages"]
                    .as_array()
                    .is_some_and(|m| m.iter().any(|v| v == "hello")));
            }
            "shell_root" => {
                assert_eq!(shell["open"], true);
                assert_eq!(shell["page"], "root");
            }
            "shell_settings" | "shell_settings_scale" => {
                assert_eq!(shell["open"], true);
                assert_eq!(shell["page"], "settings");
            }
            _ => {}
        }
    }

    if bless {
        bless_expected(&expected);
        let semantics_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("goldens/allowlist.json");
        let raw = serde_json::to_string_pretty(&allowlists).expect("serialize") + "\n";
        fs::write(semantics_path, raw).expect("write allowlist goldens");
    }
}
