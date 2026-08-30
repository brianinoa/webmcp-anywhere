import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    // Dev server mirrors the worker's WebMCP headers so document.modelContext
    // works on localhost too.
    headers: {
      "Origin-Agent-Cluster": "?1",
      "Permissions-Policy": "tools=(self)",
    },
  },
  build: { outDir: "dist", sourcemap: false },
});
