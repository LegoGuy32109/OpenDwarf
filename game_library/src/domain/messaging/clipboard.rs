#[cfg(not(target_arch = "wasm32"))]
use arboard::Clipboard;

#[cfg(not(target_arch = "wasm32"))]
pub struct ClipboardState {
    clipboard: Option<Clipboard>,
}

#[cfg(not(target_arch = "wasm32"))]
impl ClipboardState {
    pub fn new() -> Self {
        Self { clipboard: None }
    }

    pub fn read_text(&mut self) -> Result<String, String> {
        let clipboard = self.clipboard_mut()?;
        clipboard.get_text().map_err(|err| err.to_string())
    }

    pub fn write_text(&mut self, text: &str) -> Result<(), String> {
        let clipboard = self.clipboard_mut()?;
        clipboard
            .set_text(text.to_string())
            .map_err(|err| err.to_string())
    }

    fn clipboard_mut(&mut self) -> Result<&mut Clipboard, String> {
        if self.clipboard.is_none() {
            self.clipboard = Some(Clipboard::new().map_err(|err| err.to_string())?);
        }
        self.clipboard
            .as_mut()
            .ok_or_else(|| "Native clipboard unavailable".to_string())
    }
}

#[cfg(target_arch = "wasm32")]
use wasm_bindgen::JsValue;
#[cfg(target_arch = "wasm32")]
use wasm_bindgen_futures::JsFuture;
#[cfg(target_arch = "wasm32")]
use web_sys::{Clipboard, Navigator};

#[cfg(target_arch = "wasm32")]
pub async fn read_text() -> Result<String, String> {
    let window = web_sys::window().ok_or_else(|| "No window available".to_string())?;
    let navigator: Navigator = window.navigator();
    let clipboard: Clipboard = navigator.clipboard();
    let future = JsFuture::from(clipboard.read_text());
    let value = future.await.map_err(js_to_string)?;
    value
        .as_string()
        .ok_or_else(|| "Clipboard read did not return text".to_string())
}

#[cfg(target_arch = "wasm32")]
pub async fn write_text(text: &str) -> Result<(), String> {
    let window = web_sys::window().ok_or_else(|| "No window available".to_string())?;
    let navigator: Navigator = window.navigator();
    let clipboard: Clipboard = navigator.clipboard();
    let future = JsFuture::from(clipboard.write_text(text));
    future.await.map_err(js_to_string)?;
    Ok(())
}

#[cfg(target_arch = "wasm32")]
fn js_to_string(err: impl Into<JsValue>) -> String {
    let value: JsValue = err.into();
    value.as_string().unwrap_or_else(|| format!("{value:?}"))
}
