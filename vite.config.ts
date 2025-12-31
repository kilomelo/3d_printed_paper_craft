import { defineConfig } from "vite";

export default defineConfig({
  server: {
    open: true,
  },
  resolve: {
    alias: {
      "@": "/src",
    },
  },
  assetsInclude: ["**/*.wasm"],
  optimizeDeps: {
    exclude: ["replicad", "replicad-opencascadejs"],
  },
  build: {
    target: "esnext",
  },
});
