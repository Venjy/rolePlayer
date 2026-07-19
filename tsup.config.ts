import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/server/index.ts",
    "initialize-catalog": "scripts/initialize-catalog.ts",
    "split-database": "scripts/split-database.ts",
  },
  format: ["esm"],
  platform: "node",
  target: "node22",
  // node:sqlite has no legacy bare "sqlite" specifier. Keep Node's protocol
  // instead of using tsup 8's backwards-compatibility rewrite.
  removeNodeProtocol: false,
  external: ["node:sqlite"],
  outDir: "dist/server",
  clean: true,
});
