# Pixel indicator drafts

Open these native files in Aseprite to review the first art draft.

`direction-arrows.aseprite` has a 16×16 canvas and two master frames:

- Frame 1, tagged `Cardinal - north`: the upward arrow.
- Frame 2, tagged `Diagonal - northeast`: the diagonal arrow.

Josh edited the masters into chevrons and consolidated them into one layer.
`Arrow shading - gold reference` preserves those exact silhouettes and
positions. Its shading uses four opaque colors: outline `#482B0D`, shadow
`#5A3C16`, body `#F5B630`, and highlight `#FFE589`. The near-duplicate browns
are consolidated, and the inside bevel uses the same shadow role in both
masters.

The runtime assets are two grayscale role masks, not separate colored arrow
sets. See [arrow palettes](../../docs/features/arrow-palettes.md) for exporting
them and loading any four-color palette. The gold GPL palette here can also be
imported into Aseprite. Quarter-turns and flips provide the other octants. Use
nearest sampling and a shared anchor. Draw the throwing palette above the
movement palette when their pixels overlap.

`target-corners.aseprite` has a 16×16 canvas and one frame. Its four stepped
corners use one-pixel strokes and a stepped grayscale gradient from darker bends
to bright tips. Every painted pixel and the layer are fully opaque. The
background remains transparent. Apply overall opacity in the game engine,
starting at 25%, rather than baking transparency into the source art.

These are review assets. The runtime atlas and renderer integration follow the
art review. The movement/action region design is recorded in
[the design note](../../docs/floating-touch-and-pixel-indicators-design.md).
