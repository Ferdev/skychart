import { defineConfig } from "vite";

const ephemerisApi = process.env.ATLAS_EPHEMERIS_API ?? "http://127.0.0.1:8765";
const previewHosts = (process.env.RONDAR_PREVIEW_HOSTS ?? "")
  .split(",")
  .map((host) => host.trim())
  .filter(Boolean);

export default defineConfig({
  build: { manifest: true },
  server: {
    allowedHosts: previewHosts,
    host: "0.0.0.0",
    port: Number(process.env.PORT ?? "5173"),
    strictPort: true,
    proxy: {
      "/api/catalog": "http://127.0.0.1:4020",
      "/api/objects": "http://127.0.0.1:4020",
      "/api/survey-image": "http://127.0.0.1:4020",
      "/api/ephemeris": ephemerisApi,
      "/api/small-body-ephemeris": ephemerisApi,
      "/api/orbits": ephemerisApi,
      "/api/trails": ephemerisApi,
      "/api/observe": ephemerisApi,
      "/api/now": "http://127.0.0.1:4020",
      "/api/events": "http://127.0.0.1:4020",
      "/catalog-tiles": "http://127.0.0.1:4020"
    }
  }
});
