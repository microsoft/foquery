import { defineConfig } from "vite";
import { resolve } from "path";
import { copyFileSync } from "fs";

export default defineConfig({
  root: "src",
  base: "./",
  build: {
    outDir: "../dist",
    emptyDirFirst: true,
    modulePreload: false,
    rollupOptions: {
      input: {
        devtools: resolve(__dirname, "src/devtools.html"),
        panel: resolve(__dirname, "src/panel.html"),
      },
      output: {
        entryFileNames: "[name].js",
        chunkFileNames: "[name].js",
        assetFileNames: "[name].[ext]",
      },
    },
  },
  plugins: [
    {
      name: "copy-manifest",
      closeBundle() {
        copyFileSync(
          resolve(__dirname, "src/manifest.json"),
          resolve(__dirname, "dist/manifest.json"),
        );
      },
    },
  ],
});
