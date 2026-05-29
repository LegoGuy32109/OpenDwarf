import { defineConfig } from "vite";
import { fresh } from "@fresh/plugin-vite";
import tailwindcss from "@tailwindcss/vite";

function shaderTextLoader() {
  return {
    name: "shader-text-loader",
    enforce: "pre" as const,
    async load(id: string) {
      if (!id.endsWith(".vert") && !id.endsWith(".frag")) {
        return null;
      }

      const source = await Deno.readTextFile(id);
      return `export default ${JSON.stringify(source)};`;
    },
  };
}

export default defineConfig({
  server: {
    watch: {
      ignored: [
        "**/game_library/**",
        "**/exports/**",
        "**/_fresh/**",
        "**/old_plans/**",
        "**/.claude/**",
        "**/.perf_sessions/**",
      ],
    },
  },
  plugins: [
    fresh(),
    tailwindcss(),
    shaderTextLoader(),
  ],
});
