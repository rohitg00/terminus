import { state, useApi, emit, now, paramId, ok, notFound, badRequest, API_URI } from "./iii.js";
import { timingSafeEqual } from "node:crypto";
import { nanoid } from "nanoid";
import { renderErrorScreen, renderSleepScreen } from "./renderer.js";
import type { ApiRequest } from "./iii.js";
import type { Device, DeviceModel, Playlist, Screen, Firmware, DeviceSensor, DisplayResponse, SetupResponse, FirmwareHeaders, SpecialFunction } from "./types.js";

const DEVICES = "devices";
const MODELS = "models";
const LOGS = "device_logs";
const SENSORS = "device_sensors";
const FIRMWARE = "firmware";
const PLAYLISTS = "playlists";
const SCREENS = "screens";

export const DEFAULT_MODEL: DeviceModel = {
  id: "trmnl-og",
  name: "ogv2",
  label: "TRMNL OG",
  kind: "terminus",
  mimeType: "image/png",
  width: 800,
  height: 480,
  bitDepth: 2,
  colors: 4,
  rotation: 0,
  offsetX: 0,
  offsetY: 0,
  scaleFactor: 1.0,
};

async function ensureDefaultModel(): Promise<void> {
  const existing = await state.get<DeviceModel>({ scope: MODELS, key: DEFAULT_MODEL.id });
  if (!existing) {
    await state.set({ scope: MODELS, key: DEFAULT_MODEL.id, data: DEFAULT_MODEL });
  }
}

function safeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

const MAC_PATTERN = /^[a-fA-F0-9:.\-_]{6,30}$/;

function parseHeaders(req: ApiRequest): FirmwareHeaders {
  const h = req.headers || {};
  return {
    mac: h.id || h.http_id || "",
    apiKey: h.access_token || h.http_access_token || "",
    firmwareVersion: h.fw_version || h.http_fw_version || "",
    modelName: h.model || h.http_model || "",
    batteryVoltage: Number(h.battery_voltage || h.http_battery_voltage) || 0,
    batteryCharge: Number(h.percent_charged || h.http_percent_charged) || 0,
    wifi: Number(h.rssi || h.http_rssi) || 0,
    width: Number(h.width || h.http_width) || 0,
    height: Number(h.height || h.http_height) || 0,
    wakeReason: h.update_source || h.http_update_source || "",
    sensors: h.sensors || h.http_sensors || "",
  };
}

function isAsleep(device: Device): boolean {
  if (!device.sleepStartAt || !device.sleepStopAt) return false;
  const nowMinutes = new Date().getHours() * 60 + new Date().getMinutes();
  const [startH, startM] = device.sleepStartAt.split(":").map(Number);
  const [stopH, stopM] = device.sleepStopAt.split(":").map(Number);
  const start = startH * 60 + startM;
  const stop = stopH * 60 + stopM;

  if (stop < start) {
    return nowMinutes >= start || nowMinutes <= stop;
  }
  return nowMinutes >= start && nowMinutes <= stop;
}

async function getModel(modelId: string): Promise<DeviceModel> {
  const model = await state.get<DeviceModel>({ scope: MODELS, key: modelId });
  return model || DEFAULT_MODEL;
}

async function getLatestFirmware(): Promise<Firmware | null> {
  const all = await state.list<Firmware>({ scope: FIRMWARE });
  if (!all.length) return null;
  return all.sort((a, b) => b.version.localeCompare(a.version, undefined, { numeric: true }))[0];
}

async function syncSensors(deviceId: string, sensorsJson: string): Promise<void> {
  if (!sensorsJson) return;
  try {
    const sensors = JSON.parse(sensorsJson);
    if (!Array.isArray(sensors)) return;
    for (const s of sensors) {
      if (!s.make || !s.model || !s.kind) continue;
      const key = `${deviceId}-${s.make}-${s.model}-${s.kind}`;
      const existing = await state.get<DeviceSensor>({ scope: SENSORS, key });
      const sensor: DeviceSensor = existing
        ? { ...existing, value: Number(s.value) || 0, unit: s.unit || existing.unit }
        : {
            id: key, deviceId, make: s.make, model: s.model,
            kind: s.kind, value: Number(s.value) || 0, unit: s.unit || "",
            source: "device", createdAt: now(),
          };
      await state.set({ scope: SENSORS, key, data: sensor });
    }
  } catch { /* invalid json */ }
}

export async function registerDeviceEndpoints(): Promise<void> {
  await ensureDefaultModel();

  // --- Setup: device auto-provisioning ---
  useApi("setup", "GET", async (req) => {
    const headers = parseHeaders(req);
    if (!headers.mac || !MAC_PATTERN.test(headers.mac)) {
      return badRequest("Invalid device ID (MAC address)");
    }

    let device = await state.get<Device>({ scope: DEVICES, key: headers.mac });

    if (!device) {
      const fid = nanoid(6).toUpperCase();
      const apiKey = nanoid(32);
      const playlistId = `playlist-${headers.mac}`;
      const modelId = DEFAULT_MODEL.id;

      device = {
        id: headers.mac, mac: headers.mac,
        label: `TRMNL ${fid}`, friendlyId: fid, apiKey,
        modelId, playlistId,
        firmwareVersion: headers.firmwareVersion,
        firmwareBeta: false, firmwareUpdate: false,
        batteryVoltage: headers.batteryVoltage,
        batteryCharge: headers.batteryCharge,
        wifi: headers.wifi, refreshRate: 900, imageTimeout: 0,
        width: headers.width, height: headers.height,
        wakeReason: null, sleepStartAt: null, sleepStopAt: null,
        proxy: false, setupAt: now(), createdAt: now(), updatedAt: now(),
      };

      const playlist: Playlist = {
        id: playlistId, name: "Default", deviceId: headers.mac,
        mode: "automatic", items: [], currentItemId: null,
        currentItemPosition: 1, createdAt: now(), updatedAt: now(),
      };

      await Promise.all([
        state.set({ scope: DEVICES, key: headers.mac, data: device }),
        state.set({ scope: PLAYLISTS, key: playlistId, data: playlist }),
      ]);

      await emit("device::provisioned", { mac: headers.mac, friendlyId: fid });
    }

    const response: SetupResponse = {
      api_key: device.apiKey,
      friendly_id: device.friendlyId,
      image_url: `${API_URI}/assets/setup.bmp`,
      message: "Welcome to Terminus!",
    };

    return { status: 200, body: response };
  }, "Device auto-provisioning");

  // --- Display: device fetches current screen ---
  useApi("display", "GET", async (req) => {
    const headers = parseHeaders(req);
    const device = await state.get<Device>({ scope: DEVICES, key: headers.mac });

    if (!device || !safeCompare(device.apiKey, headers.apiKey)) {
      return { status: 404, body: { type: "/problem_details#device_id", status: 404, detail: "Invalid device ID.", instance: "/api/display" } };
    }

    // Sync device telemetry
    await state.update({
      scope: DEVICES, key: headers.mac,
      ops: [
        { type: "set", path: "batteryVoltage", value: headers.batteryVoltage },
        { type: "set", path: "batteryCharge", value: headers.batteryCharge },
        { type: "set", path: "wifi", value: headers.wifi },
        { type: "set", path: "firmwareVersion", value: headers.firmwareVersion || device.firmwareVersion },
        { type: "set", path: "wakeReason", value: headers.wakeReason || null },
        { type: "set", path: "width", value: headers.width || device.width },
        { type: "set", path: "height", value: headers.height || device.height },
        { type: "set", path: "updatedAt", value: now() },
      ],
    });

    if (headers.sensors) {
      syncSensors(device.id, headers.sensors).catch(() => {});
    }

    const model = await getModel(device.modelId);
    let specialFunction: SpecialFunction = "none";
    let filename = "empty.png";
    let imageUrl = "";

    // Sleep check
    if (isAsleep(device)) {
      specialFunction = "sleep";
      const screenName = `terminus_sleep_${device.friendlyId.toLowerCase()}`;
      try {
        const sleepScreen = await renderSleepScreen(model, screenName);
        filename = sleepScreen.path;
        imageUrl = `${API_URI}/api/screens/${encodeURIComponent(headers.mac)}/${sleepScreen.path}`;
      } catch {
        filename = "sleep.png";
      }
    } else {
      // Playlist rotation
      const playlist = await state.get<Playlist>({ scope: PLAYLISTS, key: device.playlistId });

      if (playlist?.items?.length) {
        if (playlist.mode === "manual") {
          const currentItem = playlist.items.find(i => i.id === playlist.currentItemId) || playlist.items[0];
          const screen = await state.get<Screen>({ scope: SCREENS, key: currentItem.screenId });
          if (screen) {
            filename = screen.imagePath;
            imageUrl = `${API_URI}/api/screens/${encodeURIComponent(headers.mac)}/${screen.imagePath}`;
          }
        } else {
          // Automatic: find next item after current position
          const sorted = [...playlist.items].sort((a, b) => a.position - b.position);
          const currentPos = playlist.currentItemId ? playlist.currentItemPosition : 0;
          let nextItem = sorted.find(i => i.position > currentPos);
          if (!nextItem) nextItem = sorted[0]; // wrap around

          if (nextItem) {
            const screen = await state.get<Screen>({ scope: SCREENS, key: nextItem.screenId });
            if (screen) {
              filename = screen.imagePath;
              imageUrl = `${API_URI}/api/screens/${encodeURIComponent(headers.mac)}/${screen.imagePath}`;
            }

            await state.update({
              scope: PLAYLISTS, key: device.playlistId,
              ops: [
                { type: "set", path: "currentItemId", value: nextItem.id },
                { type: "set", path: "currentItemPosition", value: nextItem.position },
                { type: "set", path: "updatedAt", value: now() },
              ],
            });
          }
        }
      }

      // If no screen found, render error
      if (!imageUrl) {
        const screenName = `terminus_error_${device.friendlyId.toLowerCase()}`;
        try {
          const errScreen = await renderErrorScreen(
            "Unable to obtain next screen. Playlist has no items.",
            model, screenName,
          );
          filename = errScreen.path;
          imageUrl = `${API_URI}/api/screens/${encodeURIComponent(headers.mac)}/${errScreen.path}`;
        } catch { /* fall through with empty */ }
      }
    }

    // Firmware OTA check
    let firmwareUrl: string | null = null;
    let firmwareVersion: string | null = null;
    const latest = await getLatestFirmware();
    if (latest && device.firmwareVersion !== latest.version) {
      firmwareUrl = latest.attachmentPath ? `${API_URI}/assets/firmware/${latest.attachmentPath}` : null;
      firmwareVersion = latest.version;
    }

    const response: DisplayResponse = {
      filename,
      image_url: imageUrl,
      image_url_timeout: device.imageTimeout,
      refresh_rate: device.refreshRate,
      update_firmware: device.firmwareUpdate,
      firmware_url: firmwareUrl,
      firmware_version: firmwareVersion,
      reset_firmware: false,
      special_function: specialFunction,
    };

    return { status: 200, body: response };
  }, "Device display image fetch");

  // --- Log: device sends logs (authenticated) ---
  useApi("log", "POST", async (req) => {
    const headers = parseHeaders(req);
    const device = await state.get<Device>({ scope: DEVICES, key: headers.mac });
    if (!device || !safeCompare(device.apiKey, headers.apiKey)) {
      return { status: 401, body: { error: "Invalid device or token" } };
    }
    const body = typeof req.body === "object" && req.body ? req.body as Record<string, unknown> : {};

    await state.set({
      scope: LOGS, key: `${headers.mac}-${Date.now()}`,
      data: { ...body, mac: headers.mac, timestamp: now() },
    });

    return { status: 204 };
  }, "Device log ingestion");

  // --- Admin: list/get devices (apiKey stripped) ---
  useApi("devices", "GET", async () => {
    const devices = await state.list<Device>({ scope: DEVICES });
    return ok(devices.map(({ apiKey, ...rest }) => rest));
  }, "List all devices");

  useApi("devices/:id", "GET", async (req) => {
    const device = await state.get<Device>({ scope: DEVICES, key: paramId(req) });
    if (!device) return notFound("Device");
    const { apiKey, ...sanitized } = device;
    return ok(sanitized);
  }, "Get device by ID");

  useApi("devices/:id", "PATCH", async (req) => {
    const id = paramId(req);
    const device = await state.get<Device>({ scope: DEVICES, key: id });
    if (!device) return notFound("Device");
    const body = req.body as Partial<Device> ?? {};
    const updated = {
      ...device, ...body,
      id: device.id, mac: device.mac, apiKey: device.apiKey,
      createdAt: device.createdAt, updatedAt: now(),
    };
    await state.set({ scope: DEVICES, key: id, data: updated });
    const { apiKey, ...sanitized } = updated;
    return ok(sanitized);
  }, "Update device");

  // --- Models ---
  useApi("models", "GET", async () => {
    return ok(await state.list<DeviceModel>({ scope: MODELS }));
  }, "List device models");

  useApi("models/:id", "GET", async (req) => {
    const model = await state.get<DeviceModel>({ scope: MODELS, key: paramId(req) });
    return model ? ok(model) : notFound("Model");
  }, "Get device model");

  useApi("models", "POST", async (req) => {
    const body = req.body as Partial<DeviceModel> ?? {};
    const id = body.id || nanoid(8);
    const model: DeviceModel = {
      id, name: body.name || id, label: body.label || body.name || id,
      kind: body.kind || "terminus", mimeType: body.mimeType || "image/png",
      width: body.width || 800, height: body.height || 480,
      bitDepth: body.bitDepth || 2, colors: body.colors || 4,
      rotation: body.rotation || 0, offsetX: body.offsetX || 0,
      offsetY: body.offsetY || 0, scaleFactor: body.scaleFactor || 1.0,
    };
    await state.set({ scope: MODELS, key: id, data: model });
    return { status: 201, body: { data: model } };
  }, "Create device model");

  // --- Sensors ---
  useApi("devices/:id/sensors", "GET", async (req) => {
    const deviceId = paramId(req);
    const all = await state.list<DeviceSensor>({ scope: SENSORS });
    return ok(all.filter(s => s.deviceId === deviceId));
  }, "Get device sensors");
}
