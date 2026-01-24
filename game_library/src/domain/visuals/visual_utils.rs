use bevy::color::Color;

pub fn color_from_hex(hex: &str) -> Color {
    // Strip leading `#` if present
    let hex = hex.trim_start_matches('#');

    match hex.len() {
        6 => {
            // Parse RRGGBB, assume full alpha
            let hex_bytes = u32::from_str_radix(hex, 16).unwrap();

            let red_bytes = ((hex_bytes >> 16) & 0xFF) as u8;
            let green_bytes = ((hex_bytes >> 8) & 0xFF) as u8;
            let blue_bytes = (hex_bytes & 0xFF) as u8;
            let alpha_bytes = 0xFF;

            Color::srgba_u8(red_bytes, green_bytes, blue_bytes, alpha_bytes)
        }
        8 => {
            // Parse RRGGBBAA
            let hex_bytes = u32::from_str_radix(hex, 16).unwrap();

            let red_bytes = ((hex_bytes >> 24) & 0xFF) as u8;
            let green_bytes = ((hex_bytes >> 16) & 0xFF) as u8;
            let blue_bytes = ((hex_bytes >> 8) & 0xFF) as u8;
            let alpha_bytes = (hex_bytes & 0xFF) as u8;

            Color::srgba_u8(red_bytes, green_bytes, blue_bytes, alpha_bytes)
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
    let hex_bytes = u32::from_str_radix(hex, 16).expect("Invalid 6-digit hex color RRGGBB");

    // Extract RGB bytes
    let red_bytes = ((hex_bytes >> 16) & 0xFF) as u8;
    let green_bytes = ((hex_bytes >> 8) & 0xFF) as u8;
    let blue_bytes = (hex_bytes & 0xFF) as u8;

    // Clamp percent into 0.0..=1.0 and convert to u8
    #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
    let alpha_bytes = (percent.clamp(0.0, 1.0) * 255.0).round() as u8;

    // Build Color with alpha
    Color::srgba_u8(red_bytes, green_bytes, blue_bytes, alpha_bytes)
}
