# start the project in development mode

```
deno task dev
```

# Steps to move release build of bevy project into website

```
❯ z game_library (bevy proj dir)
❯ cargo build --release --target wasm32-unknown-unknown
❯ z fresh-test (this dir)
❯ wasm-bindgen --target web --out-dir static/game ../game_library/target/wasm32-unknown-unknown/release/open_dwarf_lib.wasm
❯ wasm-opt -Oz --strip-debug static/game/open_dwarf_lib_bg.wasm -o static/game/opt_open_dwarf_lib.wasm
❯ brotli -q 11 static/game/opt_open_dwarf_lib.wasm -f -o static/game/opt_open_dwarf_lib.wasm.br
```
