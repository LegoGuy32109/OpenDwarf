# OpenDwarf Agent Instructions

## Repository Structure

- This is a mono repository.

- The Game site is hosted on a deno fresh client
- The Game is compiled into wasm using bash scripts
- The Game binary project is located at: ./game_library/

## Language

- TypeScript for the web client and WebRTC networking
- Bash for compile scripts
- Rust (for code under `game_library/`)

## Development Rules

- Follow idiomatic Rust conventions.
- Prefer safe Rust; avoid `unsafe` unless explicitly required.
- Do not add unused dependencies.
- Keep code formatted according to `rustfmt`.

## Completion Check (IMPORTANT)

- Do **not** run `cargo check` during intermediate steps.
- Run `cargo check` **once**, after all code changes are complete.

### How to Run the Check

From the repository root:

```bash
cargo check --manifest-path game_library/Cargo.toml
```

## Formatting Check

- After code changes are complete and about to end process
- Run `deno task fmt` to format all files in repo

## Formatting

### Rust

- Unmerge nested paths in use statements
- If importing a new reference outside of the current file, don't Qualify the
  whole path in line, add a use statement at the top of the file
