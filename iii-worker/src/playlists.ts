import { state, useApi, paramId, ok, created, notFound, deleted, badRequest, now } from "./iii.js";
import { nanoid } from "nanoid";
import type { Playlist, PlaylistItem, Screen } from "./types.js";

const SCOPE = "playlists";
const SCREENS = "screens";

export function registerPlaylistEndpoints(): void {

  useApi("playlists", "GET", async () => {
    return ok(await state.list<Playlist>({ scope: SCOPE }));
  }, "List playlists");

  useApi("playlists", "POST", async (req) => {
    const body = req.body as Partial<Playlist> ?? {};
    const id = nanoid(12);
    const playlist: Playlist = {
      id, name: body.name || "Default", deviceId: body.deviceId || "",
      mode: body.mode || "automatic", items: [],
      currentItemId: null, currentItemPosition: 1,
      createdAt: now(), updatedAt: now(),
    };
    await state.set({ scope: SCOPE, key: id, data: playlist });
    return created(playlist);
  }, "Create playlist");

  useApi("playlists/:id", "PATCH", async (req) => {
    const id = paramId(req);
    const playlist = await state.get<Playlist>({ scope: SCOPE, key: id });
    if (!playlist) return notFound("Playlist");
    const body = req.body as Partial<Playlist> ?? {};
    if (body.name) playlist.name = body.name;
    if (body.mode) playlist.mode = body.mode;
    playlist.updatedAt = now();
    await state.set({ scope: SCOPE, key: id, data: playlist });
    return ok(playlist);
  }, "Update playlist");

  useApi("playlists/:id/items", "POST", async (req) => {
    const id = paramId(req);
    const playlist = await state.get<Playlist>({ scope: SCOPE, key: id });
    if (!playlist) return notFound("Playlist");
    const body = req.body as { screenId: string };
    if (!body.screenId) return badRequest("screenId is required");

    const screen = await state.get<Screen>({ scope: SCREENS, key: body.screenId });
    if (!screen) return notFound("Screen");

    const item: PlaylistItem = {
      id: nanoid(8),
      screenId: body.screenId,
      position: playlist.items.length + 1,
    };
    playlist.items.push(item);
    playlist.updatedAt = now();
    await state.set({ scope: SCOPE, key: id, data: playlist });
    return created(item);
  }, "Add screen to playlist");

  useApi("playlists/:id/items/:itemId", "DELETE", async (req) => {
    const id = paramId(req);
    const itemId = req.params?.itemId || "";
    const playlist = await state.get<Playlist>({ scope: SCOPE, key: id });
    if (!playlist) return notFound("Playlist");

    playlist.items = playlist.items.filter(i => i.id !== itemId);
    playlist.items.forEach((item, idx) => { item.position = idx + 1; });
    if (playlist.currentItemId === itemId) {
      playlist.currentItemId = playlist.items[0]?.id || null;
      playlist.currentItemPosition = 1;
    } else if (playlist.currentItemId) {
      const current = playlist.items.find(i => i.id === playlist.currentItemId);
      if (current) playlist.currentItemPosition = current.position;
    }
    playlist.updatedAt = now();
    await state.set({ scope: SCOPE, key: id, data: playlist });
    return deleted();
  }, "Remove item from playlist");

  useApi("playlists/:id", "DELETE", async (req) => {
    const id = paramId(req);
    const devices = await state.list<{ playlistId: string }>({ scope: "devices" });
    const orphaned = devices.filter(d => d.playlistId === id);
    for (const d of orphaned) {
      await state.update({
        scope: "devices", key: (d as any).id,
        ops: [{ type: "set", path: "playlistId", value: "" }],
      });
    }
    await state.delete({ scope: SCOPE, key: id });
    return deleted();
  }, "Delete playlist");
}
