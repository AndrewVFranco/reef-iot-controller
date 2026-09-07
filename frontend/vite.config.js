import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],

  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },

  // Dev server — proxy API and WebSocket calls to the Pi
  // so we never deal with CORS during development.
  server: {
    proxy: {
      "/api": {
        target:       "http://192.168.1.137:8000",
        changeOrigin: true,
        rewrite:      (path) => path.replace(/^\/api/, ""),
      },
      "/ws": {
        target:       "ws://192.168.1.137:8000",
        ws:           true,
        changeOrigin: true,
        rewrite:      (path) => path.replace(/^\/ws/, ""), // This is mandatory
      },
    },
  },

  // Production build output goes to reef_controller/static/
  // so FastAPI serves it directly — no extra deploy step needed
  // beyond copying the dist folder.
  build: {
    outDir:   "../static",
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('react') || id.includes('react-dom')) return 'react';
            if (id.includes('react-router-dom')) return 'router';
            if (id.includes('recharts')) return 'charts';
            if (id.includes('zustand')) return 'zustand';
            return 'vendor'; // Fallback for other modules
          }
        }
      },
    },
  },
});
