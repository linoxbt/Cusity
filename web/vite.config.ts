import { defineConfig } from "vite";

export default defineConfig({
  base: "./",                       // relative paths: the site is served from a DeWEB Container
  server: { fs: { allow: [".."] } }, // web imports ../data/features.ts and ../build artifacts
  build: { outDir: "dist", assetsInlineLimit: 0, chunkSizeWarningLimit: 800 },
});
