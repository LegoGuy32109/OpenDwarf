#[cfg(not(target_arch = "wasm32"))]
fn main() {
  use std::{env, path::PathBuf};

  let mut out: Option<PathBuf> = None;
  let mut args = env::args().skip(1);
  while let Some(arg) = args.next() {
    match arg.as_str() {
      "--out" => {
        let value = args.next().expect("--out requires a path");
        out = Some(PathBuf::from(value));
      }
      other => {
        eprintln!("unexpected argument: {other}");
        std::process::exit(2);
      }
    }
  }

  let out = out.unwrap_or_else(|| PathBuf::from("../lib/engine/abi.generated.ts"));

  if let Err(err) = od_core::abi::write_ts_abi_file(&out) {
    eprintln!("failed to write {}: {err}", out.display());
    std::process::exit(1);
  }
}

#[cfg(target_arch = "wasm32")]
fn main() {}
