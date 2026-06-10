import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
  },
  format: ["esm"],
  // tsup's dts worker injects `baseUrl`, which TypeScript 6 flags as
  // deprecated (TS5101) — silence exactly that, per the compiler's hint.
  dts: { compilerOptions: { ignoreDeprecations: "6.0" } },
  sourcemap: true,
  clean: true,
  target: "node20",
});
