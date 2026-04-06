export type SpecialFunction =
  | "none"
  | "sleep"
  | "identify"
  | "add_wifi"
  | "restart_playlist"
  | "rewind"
  | "send_to_me";

export interface Device {
  id: string;
  mac: string;
  label: string;
  friendlyId: string;
  apiKey: string;
  modelId: string;
  playlistId: string;
  firmwareVersion: string;
  firmwareBeta: boolean;
  firmwareUpdate: boolean;
  batteryVoltage: number;
  batteryCharge: number;
  wifi: number;
  refreshRate: number;
  imageTimeout: number;
  width: number;
  height: number;
  wakeReason: string | null;
  sleepStartAt: string | null;
  sleepStopAt: string | null;
  proxy: boolean;
  setupAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DeviceModel {
  id: string;
  name: string;
  label: string;
  kind: "terminus" | "core";
  mimeType: string;
  width: number;
  height: number;
  bitDepth: number;
  colors: number;
  rotation: number;
  offsetX: number;
  offsetY: number;
  scaleFactor: number;
}

export interface Screen {
  id: string;
  name: string;
  label: string;
  extensionId: string;
  modelId: string;
  imagePath: string;
  checksum: string;
  mimeType: string;
  createdAt: string;
  updatedAt: string;
}

export interface Extension {
  id: string;
  name: string;
  kind: "webhook" | "poll" | "static" | "image";
  template: string;
  data: Record<string, unknown>;
  uris: string[];
  headers: Record<string, string>;
  verb: "GET" | "POST";
  interval: number;
  unit: "minute" | "hour" | "day";
  createdAt: string;
  updatedAt: string;
}

export interface Playlist {
  id: string;
  name: string;
  deviceId: string;
  mode: "automatic" | "manual";
  items: PlaylistItem[];
  currentItemId: string | null;
  currentItemPosition: number;
  createdAt: string;
  updatedAt: string;
}

export interface PlaylistItem {
  id: string;
  screenId: string;
  position: number;
}

export interface Firmware {
  id: string;
  version: string;
  attachmentPath: string | null;
  createdAt: string;
}

export interface DeviceSensor {
  id: string;
  deviceId: string;
  make: string;
  model: string;
  kind: string;
  value: number;
  unit: string;
  source: "device" | "server";
  createdAt: string;
}

export interface DisplayResponse {
  filename: string;
  image_url: string;
  image_url_timeout: number;
  refresh_rate: number;
  update_firmware: boolean;
  firmware_url: string | null;
  firmware_version: string | null;
  reset_firmware: boolean;
  special_function: SpecialFunction;
}

export interface SetupResponse {
  api_key: string;
  friendly_id: string;
  image_url: string;
  message: string;
}

export interface FirmwareHeaders {
  mac: string;
  apiKey: string;
  firmwareVersion: string;
  modelName: string;
  batteryVoltage: number;
  batteryCharge: number;
  wifi: number;
  width: number;
  height: number;
  wakeReason: string;
  sensors: string;
}
