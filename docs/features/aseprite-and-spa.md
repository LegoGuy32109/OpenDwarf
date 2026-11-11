# Aseprite and SPA tooling

Use SPA and Aseprite batch commands to edit sprite files through the CLI. Do not
automate the editor UI, reopen an already open sprite, or take focus from Josh.
Batch commands operate on saved files, not the editor's live document.
Coordinate saves before replacing a file that Josh has open; unsaved editor
changes can otherwise overwrite the CLI result.

## Installed setup

Verified on Josh's Arch/Omarchy laptop on November 11, 2026:

- Aseprite 1.3.18.6, Lua API 41.
- SPA 0.5.2 (`aseprite-automation`), installed with its optional MCP adapter.
- `~/.local/bin/aseprite` points through
  `~/.local/opt/aseprite/current/usr/bin/aseprite`.
- `current` selects the version under `~/.local/opt/aseprite/`.
- `~/.local/bin/spa` and `~/.local/bin/spa-mcp` are installed through uv.
- The agent skill is `~/.agents/skills/spa/SKILL.md`.

Put `~/.local/bin` on `PATH`. Check the selected runtime before editing:

```bash
aseprite --version
spa version
spa info --human
```

SPA discovers `aseprite` on `PATH`. To select it explicitly:

```bash
export SPA_ASEPRITE_EXECUTABLE="$HOME/.local/bin/aseprite"
spa info --human
```

## Official AppImage installation and upgrades

On Arch, this setup uses the official **x64 AppImage** from the Aseprite
purchase page. The Debian packages are not used. Download the licensed editor
manually; keep its binaries outside this repository.

The reusable installer lives in Josh's work-portal checkout:

```text
/home/josh/Projects/work-portal/dotfiles/aseprite/install-appimage.py
```

`~/.local/bin/aseprite-install` links to that script. To install or upgrade:

```bash
aseprite-install ~/Downloads/Aseprite_1.3.18.6-x64.AppImage
spa info --human
```

For an upgrade, substitute the newly downloaded AppImage path. The installer:

1. Extracts the AppImage with `--appimage-extract`, avoiding a FUSE requirement.
2. Places its contents under `~/.local/opt/aseprite/<version>/`.
3. Adds `usr/bin/data -> ../share/aseprite/data` inside the extracted tree. SPA
   needs this link to find resources beside the resolved executable.
4. Probes the extracted executable through SPA before switching `current`.
5. Updates the stable command and the user application launcher.
6. Keeps older installed versions and backs up the previous launcher under
   `~/.local/state/aseprite-install/backups/`.

The command and launcher use the standalone editor without Steam. The Steam
installation remains managed by Steam. Existing preferences and extensions
remain in place. The installer needs neither root access nor a system package.

On another machine with uv and Node/npm available, install SPA and its skill:

```bash
uv tool install --python 3.13 'aseprite-automation[mcp]'
npx skills add aigengame/aseprite-automation --skill spa -g \
  --agent codex claude-code opencode -y
```

Then use the work-portal installer with that machine's AppImage. Its companion
`dotfiles/aseprite/README.md` contains the installer-link setup. Upgrade SPA
separately with `uv tool upgrade aseprite-automation`.

## Agent access

Any agent with shell access can invoke SPA. Read the installed skill, then
discover each command's current request schema:

```bash
spa help
spa help paint apply
spa paint apply --schema
spa sprite get --schema
spa sprite validate --schema
```

Operations accept JSON with `--input-json '{...}'`, or a file through stdin:

```bash
spa paint apply --input-json - < patch.json
```

Read `status`, error details, and result fields. For validation, also check
`valid`, `checks`, and `findings`; successful execution alone does not mean the
expected sprite facts matched.

An MCP-capable agent can register this local stdio server:

```json
{
  "command": "/home/josh/.local/bin/spa-mcp",
  "args": ["--aseprite", "/home/josh/.local/bin/aseprite"]
}
```

Use the correct absolute home path on another machine. The enclosing MCP
configuration depends on the agent. Shell access does not require MCP. Restart
MCP clients after upgrading SPA.

## Safe file workflow

Preserve the source PNG and keep layers and animation in an editable native
file. SPA 0.5.2 rejected `.ase` paths in operations used during this work. Stage
a `.aseprite` file through Aseprite's native batch CLI instead.

Run this example from the repository root. It only reads the existing sprite and
writes temporary inspection and preview files:

```bash
sprite_work=$(mktemp -d /tmp/opendwarf-sprite.XXXXXX)
aseprite -b public/assets/dwarf.ase --save-as "$sprite_work/working.aseprite"

spa sprite get --input-json "{\"sprite_file\":\"$sprite_work/working.aseprite\",\"inspection_scope\":[\"layers\",\"frames\",\"tags\",\"cels\"]}"

spa sprite validate --input-json "{\"sprite_file\":\"$sprite_work/working.aseprite\",\"expected\":{\"width\":16,\"height\":16,\"frame_count\":16}}"

aseprite -b "$sprite_work/working.aseprite" \
  --sheet-type horizontal --sheet "$sprite_work/preview.png" \
  --data "$sprite_work/preview.json" --format json-array
```

Edit the staged file through SPA using inspected layer and cel addresses. Export
previews to temporary paths and inspect them. Before publishing the result,
check that the original native file has not changed since staging. Keep a
backup, convert the verified result to a separate `.ase` destination, and
replace the intended file only after that check. Do not overwrite
`public/assets/dwarf.png` unless the task explicitly calls for a runtime export.

Important details discovered during the dwarf edits:

- Frame numbers and layer-path entries start at 1.
- A paint target is `{"layer_path":[2],"frame_number":1}`. Do not nest a
  separate layer object inside the target.
- `paint apply` uses `image-pixel` coordinates relative to the cel image.
  Subtract the cel's position from sprite coordinates for a cropped cel.
- Each paint patch supports at most 256 addressed pixels and 256 runs. Read the
  installed schema before constructing a patch.
- For a layer-filtered sheet, put `--layer` **before the input file**:

  ```bash
  aseprite -b --layer 'Original dwarf' "$sprite_work/working.aseprite" \
    --sheet-type horizontal --sheet "$sprite_work/original-layer.png"
  ```

## Current dwarf asset

`public/assets/dwarf.ase` contains a 16×16 sprite with `Original dwarf` and
`Purple outline` layers. The `forcefield_shimmer` tag spans 16 frames at 100 ms
each: eight diagonal sweep frames followed by eight paused frames. The original
`dwarf.png` was preserved during authoring.

The game currently loads `public/assets/dwarf.png`, not the native `.ase` file.
Editing or exporting an animation does not make the runtime play it; sprite
sheet loading and frame selection need a separate client change.
