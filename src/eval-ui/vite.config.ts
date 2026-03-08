import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  root: path.resolve(__dirname),
  build: {
    outDir: path.resolve(__dirname, "../../dist/eval-ui"),
    emptyOutDir: true,
  },
  server: {
    port: 3078,
    proxy: {
      "/api": "http://localhost:3077",
    },
  },
});
