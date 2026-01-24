use std::fs;
use std::path::{Path, PathBuf};

use image::imageops::replace;
use image::{DynamicImage, RgbaImage};

/// Builds a tall spritesheet from any `Rock{n}.png` files in `directory`, ordered by `n`.
/// The output is saved as `RockTiles.png` in the same directory.
#[allow(dead_code)]
pub fn generate_rock_tileset<P: AsRef<Path>>(directory: P) -> Result<PathBuf, String> {
    let directory = directory.as_ref();

    let mut numbered_files: Vec<(u32, PathBuf)> = fs::read_dir(directory)
        .map_err(|err| format!("Failed to read directory {}: {err}", directory.display()))?
        .filter_map(|entry| {
            let entry = entry.ok()?;
            let path = entry.path();
            if !path.extension()?.eq_ignore_ascii_case("png") {
                return None;
            }
            let stem = path.file_stem()?.to_string_lossy();
            let suffix = stem.strip_prefix("Rock")?;
            let number: u32 = suffix.parse().ok()?;
            Some((number, path))
        })
        .collect();

    if numbered_files.is_empty() {
        return Err("No Rock{n}.png files found".to_string());
    }

    numbered_files.sort_by(|a, b| a.0.cmp(&b.0));

    let first_image = load_rgba(&numbered_files[0].1)?;
    let frame_width = first_image.width();
    let frame_height = first_image.height();

    let mut output = RgbaImage::new(
        frame_width,
        frame_height
            .checked_mul(numbered_files.len() as u32)
            .ok_or("Output image height overflowed")?,
    );

    for (index, (_, path)) in numbered_files.iter().enumerate() {
        let image = load_rgba(path)?;
        if image.dimensions() != (frame_width, frame_height) {
            return Err(format!(
                "Mismatched frame size in {:?}; expected {}x{}",
                path, frame_width, frame_height
            ));
        }
        let y_offset = (index as u32)
            .checked_mul(frame_height)
            .ok_or_else(|| "Output positioning overflowed".to_string())?
            as i64;
        replace(&mut output, &image, 0, y_offset);
    }

    let output_path = directory.join("RockTiles.png");
    output
        .save(&output_path)
        .map_err(|err| format!("Failed to save {:?}: {err}", output_path))?;

    Ok(output_path)
}

fn load_rgba(path: &Path) -> Result<RgbaImage, String> {
    let image = image::open(path).map_err(|err| format!("Failed to open {:?}: {err}", path))?;
    Ok(match image {
        DynamicImage::ImageRgba8(img) => img,
        other => other.to_rgba8(),
    })
}
