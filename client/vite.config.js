import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      // 开发时把 /api 请求转发到后端
      "/api": {
        target: "http://localhost:3000",
        changeOrigin: true
      }
    }
  }
});