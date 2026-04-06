export interface Device {
  id: string;
  mac: string;
  name: string;
  apiKey: string;
  friendlyId: string;
  modelId: string;
  playlistId: string;
  firmwareVersion: string;
  batteryVoltage: number;
  rssi: number;
  refreshRate: number;
  sleepStart: string | null;
  sleepEnd: string | null;
  lastSeen: string;
  createdAt: string;
}

export interface DeviceModel {
  id: string;
  name: string;
  width: number;
  height: number;
  bitDepth: number;
  rotation: number;
  format: string;
}

export interface Screen {
  id: string;
  name: string;
  extensionId: string;
  modelId: string;
  imagePath: string;
  checksum: string;
  width: number;
  height: number;
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
  items: PlaylistItem[];
  currentIndex: number;
  mode: "auto" | "manual";
  createdAt: string;
}

export interface PlaylistItem {
  id: string;
  screenId: string;
  position: number;
}
