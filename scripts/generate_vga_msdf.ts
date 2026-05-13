const FONT_PATH = "static/assets/ui/AcPlus_IBM_VGA_9x16.ttf";
const IMAGE_OUT = "static/assets/ui/AcPlus_IBM_VGA_9x16.msdf.png";
const JSON_OUT = "static/assets/ui/AcPlus_IBM_VGA_9x16.msdf.json";
const MSDF_ATLAS_GEN = Deno.env.get("MSDF_ATLAS_GEN_BIN") ?? "msdf-atlas-gen";

const CP437_CODEPOINTS = [
  0x263A,
  0x263B,
  0x2665,
  0x2666,
  0x2663,
  0x2660,
  0x2022,
  0x25D8,
  0x25CB,
  0x25D9,
  0x2642,
  0x2640,
  0x266A,
  0x266B,
  0x263C,
  0x25BA,
  0x25C4,
  0x2195,
  0x203C,
  0x00B6,
  0x00A7,
  0x25AC,
  0x21A8,
  0x2191,
  0x2193,
  0x2192,
  0x2190,
  0x221F,
  0x2194,
  0x25B2,
  0x25BC,
  ...Array.from({ length: 0x7f - 0x20 }, (_, i) => 0x20 + i),
  0x2302,
  0x00C7,
  0x00FC,
  0x00E9,
  0x00E2,
  0x00E4,
  0x00E0,
  0x00E5,
  0x00E7,
  0x00EA,
  0x00EB,
  0x00E8,
  0x00EF,
  0x00EE,
  0x00EC,
  0x00C4,
  0x00C5,
  0x00C9,
  0x00E6,
  0x00C6,
  0x00F4,
  0x00F6,
  0x00F2,
  0x00FB,
  0x00F9,
  0x00FF,
  0x00D6,
  0x00DC,
  0x00A2,
  0x00A3,
  0x00A5,
  0x20A7,
  0x0192,
  0x00E1,
  0x00ED,
  0x00F3,
  0x00FA,
  0x00F1,
  0x00D1,
  0x00AA,
  0x00BA,
  0x00BF,
  0x2310,
  0x00AC,
  0x00BD,
  0x00BC,
  0x00A1,
  0x00AB,
  0x00BB,
  0x2591,
  0x2592,
  0x2593,
  0x2502,
  0x2524,
  0x2561,
  0x2562,
  0x2556,
  0x2555,
  0x2563,
  0x2551,
  0x2557,
  0x255D,
  0x255C,
  0x255B,
  0x2510,
  0x2514,
  0x2534,
  0x252C,
  0x251C,
  0x2500,
  0x253C,
  0x255E,
  0x255F,
  0x255A,
  0x2554,
  0x2569,
  0x2566,
  0x2560,
  0x2550,
  0x256C,
  0x2567,
  0x2568,
  0x2564,
  0x2565,
  0x2559,
  0x2558,
  0x2552,
  0x2553,
  0x256B,
  0x256A,
  0x2518,
  0x250C,
  0x2588,
  0x2584,
  0x258C,
  0x2590,
  0x2580,
  0x03B1,
  0x00DF,
  0x0393,
  0x03C0,
  0x03A3,
  0x03C3,
  0x00B5,
  0x03C4,
  0x03A6,
  0x0398,
  0x03A9,
  0x03B4,
  0x221E,
  0x03C6,
  0x03B5,
  0x2229,
  0x2261,
  0x00B1,
  0x2265,
  0x2264,
  0x2320,
  0x2321,
  0x00F7,
  0x2248,
  0x00B0,
  0x2219,
  0x00B7,
  0x221A,
  0x207F,
  0x00B2,
  0x25A0,
  0x00A0,
];

const tempDir = await Deno.makeTempDir({ prefix: "open-dwarf-msdf-" });
const charsetPath = `${tempDir}/cp437.txt`;

async function findNativeMsdfAtlasGen() {
  if (Deno.env.has("MSDF_ATLAS_GEN_BIN")) return MSDF_ATLAS_GEN;

  const which = await new Deno.Command("which", {
    args: ["-a", MSDF_ATLAS_GEN],
    stdout: "piped",
    stderr: "null",
  }).output();
  if (!which.success) return MSDF_ATLAS_GEN;

  const resolvedPaths = new TextDecoder().decode(which.stdout).trim().split(
    "\n",
  )
    .filter(Boolean);
  const nativePath = resolvedPaths.find((path) =>
    !path.includes("node_modules/.bin")
  );
  if (nativePath) return nativePath;

  throw new Error(
    `Resolved ${MSDF_ATLAS_GEN} only to the broken npm wrapper at ${
      resolvedPaths[0]
    }. ` +
      "Install the native Chlumsky/msdf-atlas-gen binary and put it on PATH, " +
      "or set MSDF_ATLAS_GEN_BIN=/path/to/msdf-atlas-gen.",
  );
}

try {
  const msdfAtlasGenBin = await findNativeMsdfAtlasGen();

  await Deno.writeTextFile(
    charsetPath,
    [...new Set(CP437_CODEPOINTS)]
      .map((codePoint) => `0x${codePoint.toString(16).toUpperCase()}`)
      .join("\n") + "\n",
  );

  const command = new Deno.Command(msdfAtlasGenBin, {
    args: [
      "-font",
      FONT_PATH,
      "-charset",
      charsetPath,
      "-type",
      "msdf",
      "-format",
      "png",
      "-size",
      "64",
      "-pxrange",
      "8",
      "-dimensions",
      "1024",
      "1024",
      "-yorigin",
      "bottom",
      "-imageout",
      IMAGE_OUT,
      "-json",
      JSON_OUT,
    ],
    stdout: "inherit",
    stderr: "inherit",
  });

  const status = await command.output();
  if (!status.success) {
    throw new Error(`${msdfAtlasGenBin} exited with code ${status.code}`);
  }
} catch (error) {
  if (error instanceof Deno.errors.NotFound) {
    throw new Error(
      `Could not find ${MSDF_ATLAS_GEN}. Install Chlumsky/msdf-atlas-gen or set MSDF_ATLAS_GEN_BIN.`,
    );
  }
  throw error;
} finally {
  await Deno.remove(tempDir, { recursive: true });
}
