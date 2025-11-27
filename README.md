
```
deno task start
```

This will watch the project directory and restart as necessary.

# To compile wasm

```
 ❯ wasm-bindgen --out-dir ./lib/ --target web ./bevy_wasm/target/wasm32-unknown-unknown/debug/bevy_wasm.wasm
```

It's not complete, I have that folder and /assets moved to static so I can test it in `game.html`
Try the webassembly stream apis, and don't forget converting output to br at some point.
<https://docs.deno.com/runtime/reference/wasm/#using-the-streaming-webassembly-apis>
