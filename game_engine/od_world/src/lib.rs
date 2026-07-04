#![warn(clippy::pedantic)]

pub fn crate_name() -> &'static str {
  "od_world"
}

#[cfg(test)]
mod tests {
  #[test]
  fn smoke() {
    assert_eq!(super::crate_name(), "od_world");
  }
}

