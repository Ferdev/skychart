import { defineConfig } from "vite";

export default defineConfig({
  server: {
    proxy: {
      "/api/catalog": "http://127.0.0.1:4020",
      "/api/objects": "http://127.0.0.1:4020",
      "/api/ephemeris": "http://127.0.0.1:8765",
      "/api/orbits": "http://127.0.0.1:8765",
      "/api/trails": "http://127.0.0.1:8765"
    }
  }
});
