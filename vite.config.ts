import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      strategies: "injectManifest",
      srcDir: "src",
      filename: "service-worker.ts",
      registerType: "prompt",
      injectRegister: null,
      manifest: {
        id: "/",
        name: "BarsikChat",
        short_name: "BarsikChat",
        description: "Красивый закрытый мессенджер для вашей команды",
        theme_color: "#0b0914",
        background_color: "#0b0914",
        display: "standalone",
        orientation: "any",
        start_url: "/",
        scope: "/",
        prefer_related_applications: false,
        lang: "ru",
        categories: ["social", "productivity"],
        icons: [
          { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any maskable" },
          { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any maskable" }
        ]
      },
      injectManifest: {
        globPatterns: ["**/*.{js,css,html,png,woff2}"]
      },
      devOptions: {
        enabled: true,
        type: "module"
      }
    })
  ],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:3000",
      "/socket.io": {
        target: "http://localhost:3000",
        ws: true
      }
    }
  }
});
