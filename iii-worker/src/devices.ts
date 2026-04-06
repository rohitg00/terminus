import { state, useApi, emit, now, paramId, ok, notFound, badRequest, API_URI } from "./iii.js";
import { timingSafeEqual } from "node:crypto";
import { nanoid } from "nanoid";
import type { ApiRequest } from "./iii.js";
import type { Device, DeviceModel } from "./types.js";

const SCOPE = "devices";
const MODELS_SCOPE = "models";
const LOGS_SCOPE = "device_logs";

export const DEFAULT_MODEL: DeviceModel = {
  id: "trmnl-og",
  name: "TRMNL OG",
  width: 800,
  height: 480,
  bitDepth: 2,
  rotation: 0,
  format: "png",
};

async function ensureDefaultModel(): Promise<void> {
  const existing = await state.get<DeviceModel>({ scope: MODELS_SCOPE, key: DEFAULT_MODEL.id });
  if (!existing) {
    await state.set({ scope: MODELS_SCOPE, key: DEFAULT_MODEL.id, data: DEFAULT_MODEL });
  }
}

function safeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

const MAC_PATTERN = /^[a-fA-F0-9:.\-_]{6,30}$/;

function extractMac(req: ApiRequest): string {
  const raw = req.headers?.id || req.headers?.http_id || "";
  if (!raw || !MAC_PATTERN.test(raw)) return "";
  return raw;
}

export async function registerDeviceEndpoints(): Promise<void> {
  await ensureDefaultModel();

  useApi("setup", "GET", async (req) => {
    const mac = extractMac(req);
    const fwVersion = req.headers?.fw_version || req.headers?.http_fw_version || "unknown";

    if (!mac) return badRequest("Missing device ID (MAC address)");

    let device = await state.get<Device>({ scope: SCOPE, key: mac });

    if (!device) {
      const apiKey = nanoid(32);
      const playlistId = `playlist-${mac}`;

      const fid = nanoid(6).toUpperCase();
      device = {
        id: mac, mac,
        name: `TRMNL ${fid}`,
        apiKey, friendlyId: fid,
        modelId: DEFAULT_MODEL.id, playlistId,
        firmwareVersion: fwVersion,
        batteryVoltage: 0, rssi: 0, refreshRate: 900,
        sleepStart: null, sleepEnd: null,
        lastSeen: now(), createdAt: now(),
      };

      await Promise.all([
        state.set({ scope: SCOPE, key: mac, data: device }),
        state.set({
          scope: "playlists", key: playlistId,
          data: { id: playlistId, name: "Default", deviceId: mac, items: [], currentIndex: 0, mode: "auto", createdAt: now() },
        }),
      ]);

      await emit("device::provisioned", { mac, name: device.name });
    }

    return {
      status: 200,
      body: {
        api_key: device.apiKey,
        friendly_id: device.friendlyId,
        image_url: `${API_URI}/api/screens/${encodeURIComponent(mac)}/welcome.png`,
        message: `Device ${device.friendlyId} provisioned.`,
      },
    };
  }, "Device auto-provisioning");

  useApi("display", "GET", async (req) => {
    const mac = extractMac(req);
    const token = req.headers?.access_token || "";

    const device = await state.get<Device>({ scope: SCOPE, key: mac });
    if (!device || !safeCompare(device.apiKey, token)) {
      return { status: 401, body: { error: "Invalid device or token" } };
    }

    await state.update({
      scope: SCOPE, key: mac,
      ops: [
        { type: "set", path: "lastSeen", value: now() },
        { type: "set", path: "batteryVoltage", value: Number(req.headers?.battery_voltage) || 0 },
        { type: "set", path: "rssi", value: Number(req.headers?.rssi) || 0 },
      ],
    });

    const playlist = await state.get<{ items: { screenId: string }[]; currentIndex: number; mode: string }>({
      scope: "playlists", key: device.playlistId,
    });

    let imageUrl = "";
    let filename = "empty.png";

    if (playlist?.items?.length) {
      const idx = playlist.currentIndex % playlist.items.length;
      const screen = await state.get<{ imagePath: string }>({ scope: "screens", key: playlist.items[idx].screenId });

      if (screen) {
        imageUrl = `${API_URI}/api/screens/${encodeURIComponent(mac)}/${screen.imagePath}`;
        filename = screen.imagePath;
      }

      if (playlist.mode === "auto") {
        await state.update({
          scope: "playlists", key: device.playlistId,
          ops: [{ type: "set", path: "currentIndex", value: (idx + 1) % playlist.items.length }],
        });
      }
    }

    return {
      status: 200,
      body: {
        filename, image_url: imageUrl, image_url_timeout: 0,
        refresh_rate: device.refreshRate,
        firmware_url: null, firmware_version: device.firmwareVersion,
        update_firmware: false, special_function: "none", reset_firmware: false,
      },
    };
  }, "Device display image fetch");

  useApi("log", "POST", async (req) => {
    const mac = extractMac(req);
    const token = req.headers?.access_token || "";
    const device = await state.get<Device>({ scope: SCOPE, key: mac });
    if (!device || !safeCompare(device.apiKey, token)) {
      return { status: 401, body: { error: "Invalid device or token" } };
    }
    const body = typeof req.body === "object" && req.body ? req.body as Record<string, unknown> : {};

    await state.set({
      scope: LOGS_SCOPE,
      key: `${mac}-${Date.now()}`,
      data: { ...body, mac, timestamp: now() },
    });

    return { status: 204 };
  }, "Device log ingestion");

  useApi("devices", "GET", async () => {
    const devices = await state.list<Device>({ scope: SCOPE });
    return ok(devices.map(({ apiKey, ...rest }) => rest));
  }, "List all devices");

  useApi("devices/:id", "GET", async (req) => {
    const device = await state.get<Device>({ scope: SCOPE, key: paramId(req) });
    if (!device) return notFound("Device");
    const { apiKey, ...sanitized } = device;
    return ok(sanitized);
  }, "Get device by ID");
}
