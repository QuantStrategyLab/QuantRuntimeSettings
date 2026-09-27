import { defineConfig } from "vite";

export default defineConfig({
  base: "/v2/",
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: false,
    manifest: false,
    rollupOptions: {
      output: {
        entryFileNames: "assets/[name]-[hash].js",
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]",
      },
    },
  },
});
