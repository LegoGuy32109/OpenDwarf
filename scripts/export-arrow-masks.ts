// Export lossless role masks from the approved Aseprite shading source.
// deno run --allow-read --allow-write --allow-run scripts/export-arrow-masks.ts
import {
  ARROW_ROLES,
  encodeArrowMask,
  parseArrowPalette,
} from "../src/shared/arrow-palette.js";

async function run(command: string, args: string[], input?: Uint8Array) {
  const child = new Deno.Command(command, {
    args,
    stdin: input ? "piped" : "null",
    stdout: "piped",
    stderr: "piped",
  }).spawn();
  if (input) {
    const writer = child.stdin.getWriter();
    await writer.write(input);
    await writer.close();
  }
  const result = await child.output();
  if (!result.success) throw new Error(new TextDecoder().decode(result.stderr));
  return result.stdout;
}

await run("aseprite", [
  "-b",
  "art/ui/target-corners.aseprite",
  "--save-as",
  "public/assets/ui/target-corners.png",
]);

const palette: unknown = JSON.parse(
  await Deno.readTextFile("public/assets/ui/palettes/gold.json"),
);
const temp = await Deno.makeTempDir({ prefix: "opendwarf-arrow-masks-" });
try {
  const sheet = `${temp}/source.png`;
  await run("aseprite", [
    "-b",
    "art/ui/direction-arrows.aseprite",
    "--sheet-type",
    "horizontal",
    "--sheet",
    sheet,
  ]);
  const size = new TextDecoder().decode(
    await run("magick", ["identify", "-format", "%wx%h", sheet]),
  );
  if (size !== "32x16") {
    throw new Error("Arrow source must contain two 16x16 master frames");
  }
  const raw = await run("magick", [sheet, "-depth", "8", "rgba:-"]);
  await Deno.mkdir("public/assets/ui", { recursive: true });
  for (const [frame, name] of ["cardinal", "diagonal"].entries()) {
    const data = new Uint8ClampedArray(16 * 16 * 4);
    for (let y = 0; y < 16; y++) {
      data.set(
        raw.slice((y * 32 + frame * 16) * 4, (y * 32 + frame * 16 + 16) * 4),
        y * 16 * 4,
      );
    }
    const mask = encodeArrowMask({ width: 16, height: 16, data }, palette);
    await run("magick", [
      "-size",
      "16x16",
      "-depth",
      "8",
      "rgba:-",
      `public/assets/ui/arrow-${name}-mask.png`,
    ], new Uint8Array(mask.data));
  }
  const colors = parseArrowPalette(palette);
  const swatches = colors.map((color, i) =>
    `${color.slice(0, 3).join(" ")} ${ARROW_ROLES[i]}`
  );
  await Deno.writeTextFile(
    "art/ui/arrow-gold.gpl",
    [
      "GIMP Palette",
      "Name: OpenDwarf Arrow Gold",
      "Columns: 4",
      "#",
      ...swatches,
      "",
    ].join("\n"),
  );
  console.log("Exported two 16x16 role masks and the four-color gold palette.");
} finally {
  await Deno.remove(temp, { recursive: true });
}
