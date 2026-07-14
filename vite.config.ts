import { defineConfig } from "vite";

const ephemerisApi = process.env.ATLAS_EPHEMERIS_API ?? "http://127.0.0.1:8765";

export default defineConfig({
  build: { manifest: true },
  server: {
    proxy: {
      "/api/catalog": "http://127.0.0.1:4020",
      "/api/objects": "http://127.0.0.1:4020",
      "/api/ephemeris": ephemerisApi,
      "/api/orbits": ephemerisApi,
      "/api/trails": ephemerisApi
    }
  }
});
