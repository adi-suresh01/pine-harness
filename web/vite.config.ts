import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const api = "http://localhost:3000";

export default defineConfig({
  root: import.meta.dirname,
  plugins: [react()],
  build: { outDir: "dist", emptyOutDir: true },
  server: {
    port: 5173,
    proxy: { "/api": { target: api, changeOrigin: true }, "/runs": api },
  },
});
