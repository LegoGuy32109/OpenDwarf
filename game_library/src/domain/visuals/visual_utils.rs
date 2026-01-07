use bevy::color::Color;

pub fn color_from_hex(hex: &str) -> Color {
    // Strip leading `#` if present
    let hex = hex.trim_start_matches('#');

    match hex.len() {
        6 => {
            // Parse RRGGBB, assume full alpha
            let v = u32::from_str_radix(hex, 16).unwrap();

            let r = ((v >> 16) & 0xFF) as u8;
            let g = ((v >> 8) & 0xFF) as u8;
            let b = (v & 0xFF) as u8;
            let a = 0xFF;

            Color::srgba_u8(r, g, b, a)
        }
        8 => {
            // Parse RRGGBBAA
            let v = u32::from_str_radix(hex, 16).unwrap();

            let r = ((v >> 24) & 0xFF) as u8;
            let g = ((v >> 16) & 0xFF) as u8;
            let b = ((v >> 8) & 0xFF) as u8;
            let a = (v & 0xFF) as u8;

            Color::srgba_u8(r, g, b, a)
        }
        _ => panic!(
            "Invalid hex color length: expected 6 or 8, got {}",
            hex.len()
        ),
    }
}

pub fn color_from_hex_alpha(hex: &str, percent: f32) -> Color {
    // Strip leading `#` if present
    let hex = hex.trim_start_matches('#');

    // Parse the 6-digit hex into a 24-bit number
    let v = u32::from_str_radix(hex, 16).expect("Invalid 6-digit hex color RRGGBB");

    // Extract RGB bytes
    let r = ((v >> 16) & 0xFF) as u8;
    let g = ((v >> 8) & 0xFF) as u8;
    let b = (v & 0xFF) as u8;

    // Clamp percent into 0.0..=1.0 and convert to u8
    let a = (percent.clamp(0.0, 1.0) * 255.0).round() as u8;

    // Build Color with alpha
    Color::srgba_u8(r, g, b, a)
}
