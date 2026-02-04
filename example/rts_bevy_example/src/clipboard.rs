use std::io::Write;
use std::process::{Command, Stdio};

use bevy::log::warn;

pub struct ClipboardClient {
}

impl ClipboardClient {
    pub fn new() -> Self {
        Self {}
    }

    pub fn read_text(&mut self) -> Result<String, String> {
        #[cfg(all(
            unix,
            not(any(target_os = "macos", target_os = "android", target_os = "emscripten"))
        ))]
        {
            read_wl_paste()
        }
        #[cfg(not(all(
            unix,
            not(any(target_os = "macos", target_os = "android", target_os = "emscripten"))
        )))]
        {
            return Err("Clipboard unsupported on this platform (Linux-only)".to_string());
        }
    }

    pub fn write_text(&mut self, text: &str) -> Result<(), String> {
        #[cfg(all(
            unix,
            not(any(target_os = "macos", target_os = "android", target_os = "emscripten"))
        ))]
        {
            if let Err(err) = write_wl_copy(text) {
                warn!("wl-copy failed: {err}");
            }
            Ok(())
        }
        #[cfg(not(all(
            unix,
            not(any(target_os = "macos", target_os = "android", target_os = "emscripten"))
        )))]
        {
            return Err("Clipboard unsupported on this platform (Linux-only)".to_string());
        }
    }
}

impl Default for ClipboardClient {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(all(
    unix,
    not(any(target_os = "macos", target_os = "android", target_os = "emscripten"))
))]
fn write_wl_copy(text: &str) -> Result<(), String> {
    let mut child = Command::new("wl-copy")
        .arg("--type")
        .arg("text/plain;charset=utf-8")
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| e.to_string())?;

    if let Some(stdin) = child.stdin.as_mut() {
        stdin
            .write_all(text.as_bytes())
            .map_err(|e| e.to_string())?;
    }

    let _ = child.wait();
    Ok(())
}

#[cfg(all(
    unix,
    not(any(target_os = "macos", target_os = "android", target_os = "emscripten"))
))]
fn read_wl_paste() -> Result<String, String> {
    let output = Command::new("wl-paste")
        .arg("--no-newline")
        .output()
        .map_err(|e| e.to_string())?;
    if !output.status.success() {
        return Err(format!("wl-paste exited with {}", output.status));
    }
    String::from_utf8(output.stdout).map_err(|e| e.to_string())
}
