import { readFile } from "node:fs/promises";
import { join, basename } from "node:path";
import { state, useApi, useCron, emit, now, paramId, ok, created, notFound, deleted } from "./iii.js";
import { renderScreen } from "./renderer.js";
import { DEFAULT_MODEL } from "./devices.js";
import { nanoid } from "nanoid";
import type { Extension, Screen, DeviceModel, DeviceSensor } from "./types.js";

const SCOPE = "extensions";
const SCREENS = "screens";
const SCREENS_DIR = join(process.cwd(), "screens");

let cachedModel: DeviceModel | null = null;
let cachedModelAt = 0;
const MODEL_CACHE_TTL = 60_000;

async function getModel(): Promise<DeviceModel> {
  const elapsed = Date.now() - cachedModelAt;
  if (cachedModel && elapsed < MODEL_CACHE_TTL) return cachedModel;
  const model = await state.get<DeviceModel>({ scope: "models", key: DEFAULT_MODEL.id });
  cachedModel = model || DEFAULT_MODEL;
  cachedModelAt = Date.now();
  return cachedModel;
}

async function getSensorContext(deviceId?: string): Promise<Record<string, unknown>[]> {
  if (!deviceId) return [];
  try {
    const all = await state.list<DeviceSensor>({ scope: "device_sensors" });
    return all
      .filter(s => s.deviceId === deviceId)
      .map(s => ({
        device_id: s.deviceId, make: s.make, model: s.model,
        kind: s.kind, value: s.value, unit: s.unit,
        source: s.source, created_at: s.createdAt,
      }));
  } catch { return []; }
}

export function registerExtensionEndpoints(): void {

  useApi("extensions", "GET", async () => {
    return ok(await state.list<Extension>({ scope: SCOPE }));
  }, "List extensions");

  useApi("extensions", "POST", async (req) => {
    const body = req.body as Partial<Extension> ?? {};
    const id = nanoid(12);
    const ext: Extension = {
      id, name: body.name || "Untitled", kind: body.kind || "webhook",
      template: body.template || "", data: body.data || {},
      uris: body.uris || [], headers: body.headers || {},
      verb: body.verb || "GET", interval: body.interval || 15,
      unit: body.unit || "minute", createdAt: now(), updatedAt: now(),
    };
    await state.set({ scope: SCOPE, key: id, data: ext });
    await emit("extension::created", { id, name: ext.name, kind: ext.kind });
    return created(ext);
  }, "Create extension");

  useApi("extensions/:id", "GET", async (req) => {
    const ext = await state.get<Extension>({ scope: SCOPE, key: paramId(req) });
    return ext ? ok(ext) : notFound("Extension");
  }, "Get extension");

  useApi("extensions/:id", "PATCH", async (req) => {
    const id = paramId(req);
    const ext = await state.get<Extension>({ scope: SCOPE, key: id });
    if (!ext) return notFound("Extension");
    const body = req.body as Partial<Extension> ?? {};
    const updated = { ...ext, ...body, id, createdAt: ext.createdAt, updatedAt: now() };
    await state.set({ scope: SCOPE, key: id, data: updated });
    return ok(updated);
  }, "Update extension");

  useApi("extensions/:id", "DELETE", async (req) => {
    await state.delete({ scope: SCOPE, key: paramId(req) });
    return deleted();
  }, "Delete extension");

  useApi("extensions/:id/webhook", "POST", async (req) => {
    const id = paramId(req);
    const ext = await state.get<Extension>({ scope: SCOPE, key: id });
    if (!ext) return notFound("Extension");

    const mergeVars = (req.body as Record<string, unknown>)?.merge_variables || req.body || {};
    ext.data = mergeVars as Record<string, unknown>;
    ext.updatedAt = now();
    await state.set({ scope: SCOPE, key: id, data: ext });

    await emit("extension::data_received", { id, name: ext.name });
    renderExtension(ext).catch(err => console.error(`Async render failed: ${(err as Error).message}`));

    return ok(mergeVars);
  }, "Webhook data ingestion");

  useApi("screens/:mac/:filename", "GET", async (req) => {
    const filename = basename(req.params?.filename || "");
    if (!filename) {
      return { status: 400, body: { error: "Invalid filename" } };
    }
    try {
      const data = await readFile(join(SCREENS_DIR, filename));
      const mimeType = filename.endsWith(".bmp") ? "image/bmp" : "image/png";
      return { status: 200, headers: { "content-type": mimeType }, body: data };
    } catch {
      return notFound("Screen");
    }
  }, "Serve screen image");

  useCron("0 */5 * * * *", async () => {
    const extensions = await state.list<Extension>({ scope: SCOPE });
    const pollable = extensions.filter(e => e.kind === "poll" && e.uris.length > 0);
    await Promise.all(pollable.map(fetchAndRender));
  }, "Refresh polling extensions every 5 minutes");
}

async function renderExtension(ext: Extension, deviceId?: string): Promise<void> {
  if (!ext.template) return;
  const model = await getModel();

  const sensors = await getSensorContext(deviceId);
  const templateData = { ...ext.data, sensors };
  const screenName = `terminus_${ext.kind}_${ext.name.toLowerCase().replace(/\s+/g, "_")}`;

  try {
    const { path, checksum } = await renderScreen(ext.template, templateData, model, screenName);

    const screen: Screen = {
      id: `screen-${ext.id}`, name: screenName,
      label: ext.name, extensionId: ext.id,
      modelId: model.id, imagePath: path, checksum,
      mimeType: model.mimeType,
      createdAt: now(), updatedAt: now(),
    };

    await state.set({ scope: SCREENS, key: screen.id, data: screen });
    await emit("screen::rendered", { extensionId: ext.id, screenName, checksum });
  } catch (err) {
    console.error(`Render failed for ${ext.name}:`, (err as Error).message);
  }
}

async function fetchAndRender(ext: Extension): Promise<void> {
  try {
    const results = await Promise.all(
      ext.uris.map(async (uri, i) => {
        const resp = await fetch(uri, {
          method: ext.verb, headers: ext.headers,
          signal: AbortSignal.timeout(10000),
        });
        if (!resp.ok) throw new Error(`HTTP ${resp.status} from ${uri}`);
        const key = ext.uris.length === 1 ? "source" : `source_${i + 1}`;
        const ct = resp.headers.get("content-type") || "";
        const value = ct.includes("json") ? await resp.json() : await resp.text();
        return [key, value] as const;
      }),
    );

    ext.data = Object.fromEntries(results);
    ext.updatedAt = now();
    await state.set({ scope: SCOPE, key: ext.id, data: ext });
    await renderExtension(ext);
  } catch (err) {
    console.error(`Fetch failed for ${ext.name}:`, (err as Error).message);
  }
}
