import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "next/navigation": path.resolve(__dirname, "./src/electron-patches/next-navigation.ts"),
      "next/link": path.resolve(__dirname, "./src/electron-patches/next-link.tsx"),
      "@/context/SocketContext": path.resolve(__dirname, "./src/electron-patches/SocketContext.electron.tsx"),
    },
  },
  base: "./",
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  server: {
    port: 5173,
  },
});
