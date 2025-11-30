# start the project in development mode

```
deno task dev
```

# Steps to move release build of bevy project into website

```
❯ z bevy_wasm (bevy proj dir)
❯ cargo build --release --target wasm32-unknown-unknown
❯ z fresh-test (this dir)
❯ wasm-bindgen --target web --out-dir static/game ../bevy_wasm/target/wasm32-unknown-unknown/release/bevy_wasm.wasm
❯ wasm-opt -Oz --strip-debug static/game/bevy_wasm_bg.wasm -o static/game/opt_bevy_wasm.wasm
❯ brotli -q 11 static/game/opt_bevy_wasm.wasm -f -o static/game/opt_bevy_wasm.wasm.br
```
