# Open Dwarf

A dwarf fortress inspired game playable in your browser

Connect with other players through WebRTC

## Usage

Make sure to install Deno:
[getting_started](https://deno.land/manual/getting_started/installation)

Then start the project:

```bash
deno task dev
```

This will watch the project directory and restart as necessary.

## Compile

To create the wasm files to run in the web app

```bash
deno task web-release
```

For quicker iteration reachable at
[localhost://8000/?debug](localhost://8000/?debug)

```bash
deno task web-dev
```
