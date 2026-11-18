import { defineConfig } from "vite";
import { resolve } from "node:path";

const page = (name: string) => resolve(__dirname, `${name}.html`);

export default defineConfig({
  base: "./",                       // relative paths: the site is also served from a DeWEB Container
  server: { fs: { allow: [".."] } }, // web imports ../data/features.ts and ../build artifacts
  build: {
    outDir: "dist", assetsInlineLimit: 0, chunkSizeWarningLimit: 800,
    rollupOptions: { input: { index: page("index"), check: page("check"), explain: page("explain"), audit: page("audit"), appeal: page("appeal") } },
  },
});
