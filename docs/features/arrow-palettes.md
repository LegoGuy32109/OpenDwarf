# Arrow masks and interchangeable palettes

The edited Aseprite source is `art/ui/direction-arrows.aseprite`. It contains
two 16×16 masters, cardinal north and diagonal northeast. Its single gold
reference layer uses four consistent roles: outline, shadow, body, highlight.
Source pixels are opaque, with a transparent background. Both original
silhouettes and positions are preserved.

Export the source without baking colors into the runtime masks:

```sh
deno run --allow-read --allow-write --allow-run scripts/export-arrow-masks.ts
```

The exporter uses Aseprite batch mode and ImageMagick. It refuses colors outside
the approved gold palette instead of guessing their shading role. It writes
`public/assets/ui/arrow-cardinal-mask.png` and `arrow-diagonal-mask.png`, plus
an importable gold GPL palette under `art/ui/`. It also exports the target
corners from their native source.

Each opaque mask pixel has one of four grayscale values:

| RGB value | Role      |
| --------- | --------- |
| 0         | Outline   |
| 85        | Shadow    |
| 170       | Body      |
| 255       | Highlight |

Alpha stores coverage. Black with alpha 255 is the outline, not transparency.
Use nearest sampling. Do not smooth or compress these values lossily.

A palette is a JSON object with four `#RRGGBB` or `#RRGGBBAA` colors:

```json
{
  "outline": "#482B0D",
  "shadow": "#5A3C16",
  "body": "#F5B630",
  "highlight": "#FFE589"
}
```

Gold, neutral movement, and purple examples live in
`public/assets/ui/palettes/`. Any four colors work. Palette alpha multiplies
mask coverage. Overall draw opacity remains an engine decision.

The browser loader accepts a palette object or a palette JSON URL:

```js
import { arrowCanvas, createArrowPaletteLoader } from "./arrow-palettes.js";

const arrows = createArrowPaletteLoader();
const gold = await arrows.load("assets/ui/palettes/gold.json");
const cardinal = arrowCanvas(gold.cardinal);
const diagonal = arrowCanvas(gold.diagonal);
// Upload these canvases as textures once, then reuse them for every entity.
```

PNG masks load once. Recolored buffers are shared by color values, including
equivalent palette objects and files. The default bounded cache retains 64
palettes and retries failed loads. Recoloring belongs at theme selection, not
inside the frame loop. Call `clear()` to reload palette files after edits.

The world renderer loads neutral movement and gold throwing palettes during
startup, builds eight octants with exact quarter-turns, and uploads each atlas
once. Active movement and aiming draw independently. Throwing draws last at the
same anchor, so its color wins when both arrows face the same direction. Idle
movement arrows disappear, including after releasing a blocked movement input.

`renderer.setArrowPalette("movement" | "throw", paletteObjectOrURL)` changes
colors without changing masks. It replaces the GPU texture outside the frame
loop. Source corners load from `assets/ui/target-corners.png`, with the opaque
stepped gradient multiplied by 25% engine opacity. The held icon stays centered.

Touch movement starts anywhere in the lower-left region and fixes its origin
until release. Its circle appears only while held. The lower-right action panel
uses its whole rectangle, and drag aiming uses world arrows without a second
joystick well. Chat, sprint, and inventory controls take hit-test priority.

Unit tests cover exact roles, alpha, invalid shades, source export, caching,
mutation during loading, retries and eviction. `arrow-palettes.spec.ts` loads
the actual two PNGs and three JSON palettes in the browser, checks identical
silhouettes and exact recoloring, and captures the palette preview.
