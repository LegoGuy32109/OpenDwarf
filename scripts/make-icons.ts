// Make the page icons from the dwarf sprite, scaled up without smoothing.
//
// deno run --allow-run scripts/make-icons.ts
//
// public/assets/icon-32.png and icon-192.png are the favicon (transparent);
// public/assets/apple-touch-icon.png is 180×180 on the game's dark background,
// because iOS fills a home screen icon's transparent pixels with black.
// Needs ImageMagick (`magick`).

const SPRITE = "public/assets/dwarf.png";
const BACKGROUND = "#17191c";

async function magick(args: string[]) {
  const result = await new Deno.Command("magick", { args }).output();
  if (!result.success) {
    throw new Error(new TextDecoder().decode(result.stderr));
  }
}

for (const size of [32, 192]) {
  await magick([
    SPRITE,
    "-filter",
    "point",
    "-resize",
    `${size}x${size}`,
    `PNG32:public/assets/icon-${size}.png`,
  ]);
}
// 16 px × 10 = 160, centered on 180 with a margin.
await magick([
  SPRITE,
  "-filter",
  "point",
  "-resize",
  "160x160",
  "-background",
  BACKGROUND,
  "-gravity",
  "center",
  "-extent",
  "180x180",
  "-alpha",
  "remove",
  "public/assets/apple-touch-icon.png",
]);
console.log("Wrote icon-32.png, icon-192.png, apple-touch-icon.png");
