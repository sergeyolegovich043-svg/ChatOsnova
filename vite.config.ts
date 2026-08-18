import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const isDevelopment = mode === "development" || env.VITE_APP_ENV === "development";
  const devApiTarget = env.VITE_DEV_API_TARGET || "http://127.0.0.1:3000";

  return {
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
        name: isDevelopment ? "BarsikChat Dev" : "BarsikChat",
        short_name: isDevelopment ? "Barsik Dev" : "BarsikChat",
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
    port: Number(env.VITE_DEV_PORT || 5173),
    strictPort: true,
    allowedHosts: [".trycloudflare.com"],
    proxy: {
      "/api": devApiTarget,
      "/socket.io": {
        target: devApiTarget,
        ws: true
      }
    }
  }
  };
});
