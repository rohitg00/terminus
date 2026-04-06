import "./iii.js";
import { useApi, ok } from "./iii.js";
import { registerDeviceEndpoints } from "./devices.js";
import { registerExtensionEndpoints } from "./extensions.js";
import { registerPlaylistEndpoints } from "./playlists.js";
import { shutdownRenderer } from "./renderer.js";

await registerDeviceEndpoints();
registerExtensionEndpoints();
registerPlaylistEndpoints();

useApi("health", "GET", async () => ok({
  service: "terminus-iii",
  version: "0.1.0",
  uptime: process.uptime(),
  timestamp: new Date().toISOString(),
}), "Health check");

process.on("SIGTERM", async () => {
  try { await shutdownRenderer(); }
  catch (err) { console.error("Shutdown error:", err); }
  process.exit(0);
});

console.log("Terminus (iii-engine) — TRMNL BYOS server ready");
