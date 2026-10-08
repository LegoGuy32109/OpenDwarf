# Open Dwarf

A small browser world for testing movement, touch controls, chat, and direct
WebRTC connections. This branch starts from `webgl-version` and has no client
build step or Rust runtime. The
[live-session vision](docs/live-session-vision.md) and
[shared vocabulary](CONTEXT.md) record the next group-demo milestone.

## Run

```sh
deno task dev      # local shell serving the working tree at http://localhost:8000/
deno task start    # the same shell without the watcher
deno task verify   # format, lint, types, unit tests (the pre-push hook)
deno task e2e      # Playwright browser tests, about two minutes
deno task hooks    # install the pre-push hook
```

Details are in [testing and evidence](docs/features/testing-and-evidence.md).

## Builds, previews, and main

A pushed branch is a preview at `https://od.joshhale.me/b/<branch>`. Production
`/` serves main, which changes only with `deno task od promote ... --prod`. Only
shell code needs `deno task deploy`. See
[shell and builds](docs/features/shell-and-builds.md).

## Controls

| Action           | Keyboard              | Touch                        |
| ---------------- | --------------------- | ---------------------------- |
| Move             | ESDF                  | left stick                   |
| Speed, sprint    | G, H                  | buttons under the left stick |
| Aim, pan         | IJKL                  | right stick                  |
| View level, zoom | R/V, U/N, mouse wheel | two-finger drag, pinch       |
| Interact, mine   | Space                 | pickaxe button               |
| Inventory        | B                     | bag button                   |
| Chat, command    | T, `/`                | A button                     |
| Menu             | Escape, Q             | B button                     |

Gamepad buttons and the rest are in
[controls and UI](docs/features/controls-and-ui.md).

## Documentation

[Architecture](docs/architecture.md) shows how the world host, guests, shell,
and builds fit together. Each feature has one document, and a ticket documents
its feature there:

- [World and terrain](docs/features/world-and-terrain.md)
- [Movement](docs/features/movement.md)
- [Sight and view modes](docs/features/sight.md)
- [Mining and items](docs/features/mining-and-items.md)
- [Inventory and shop](docs/features/inventory-and-shop.md)
- [Placing](docs/features/placing.md)
- [Reach and the free cursor](docs/features/reach.md)
- [Chat](docs/features/chat.md)
- [Chatter](docs/features/chatter.md)
- [Music](docs/features/music.md)
- [Sound effects](docs/features/sound-effects.md)
- [Controls and UI](docs/features/controls-and-ui.md)
- [Networking](docs/features/networking.md)
- [Sessions and signaling](docs/features/sessions-and-signaling.md)
- [Shell and builds](docs/features/shell-and-builds.md)
- [Media](docs/features/media.md)
- [Offline play](docs/features/offline.md)
- [Admin dashboard](docs/features/admin-dashboard.md)
- [Testing and evidence](docs/features/testing-and-evidence.md)
- [Sound events](docs/features/sound-events.md)
- [Cursor](docs/features/cursor.md)

<!-- Add a line here for each new docs/features/*.md file. -->

Decisions:

- [ADR 0001: Browser-hosted world](docs/adr/0001-browser-hosted-world-for-live-sessions.md)
- [ADR 0002: Continuous horizontal positions](docs/adr/0002-continuous-horizontal-positions.md)
- [ADR 0003: Chunked terrain generated on demand](docs/adr/0003-chunked-terrain-generated-on-demand.md)
- [ADR 0004: Shell serves builds from commits](docs/adr/0004-shell-serves-builds-from-commits.md)
- [ADR 0005: Bounded terrain sync and chunk unloading](docs/adr/0005-bounded-terrain-sync-and-chunk-unloading.md)
- [ADR 0006: Speech chatter and the queued reveal](docs/adr/0006-speech-chatter-and-queued-reveal.md)
- [ADR 0007: Media from R2 and offline play](docs/adr/0007-media-from-r2-and-offline-play.md)
- [ADR 0008: Sound effects from samples](docs/adr/0008-sound-effects-from-samples.md)
- [ADR 0009: Reach, a free cursor, and the controller layout](docs/adr/0009-reach-free-cursor-and-controller.md)

<!-- Add a line here for each new ADR. -->

Design notes: [movement](docs/movement-design.md),
[multiplayer protocol](docs/multiplayer-protocol-design.md),
[sight boundary](docs/sight-boundary-design.md),
[live-session vision](docs/live-session-vision.md), and
[stress runs](docs/stress-runs/README.md).

## Credits

The stone floor, the ore tiles (`public/assets/floor.png`, `ores.png`), and the
item icons (`items.png`, from `art/excalibur/item/`) come from
[Excalibur](https://www.curseforge.com/minecraft/texture-packs/excalibur) by
Maffhew, licensed
[CC BY-NC-ND 3.0](http://creativecommons.org/licenses/by-nc-nd/3.0/us/). The
floor's stone frames are lightly edited. Sound effect samples come from
Minecraft mods and resource packs; each sample's `note` in
`media/index/sfx.v1.json` names its source.
