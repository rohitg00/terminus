import { state, useApi, paramId, ok, created, notFound, deleted, now } from "./iii.js";
import { nanoid } from "nanoid";
import type { Playlist, PlaylistItem } from "./types.js";

const SCOPE = "playlists";

export function registerPlaylistEndpoints(): void {

  useApi("playlists", "GET", async () => {
    return ok(await state.list<Playlist>({ scope: SCOPE }));
  }, "List playlists");

  useApi("playlists", "POST", async (req) => {
    const body = req.body as Partial<Playlist> ?? {};
    const id = nanoid(12);
    const playlist: Playlist = {
      id, name: body.name || "Default", deviceId: body.deviceId || "",
      items: [], currentIndex: 0, mode: body.mode || "auto", createdAt: now(),
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
    await state.set({ scope: SCOPE, key: id, data: playlist });
    return ok(playlist);
  }, "Update playlist");

  useApi("playlists/:id/items", "POST", async (req) => {
    const id = paramId(req);
    const playlist = await state.get<Playlist>({ scope: SCOPE, key: id });
    if (!playlist) return notFound("Playlist");
    const body = req.body as { screenId: string };
    const item: PlaylistItem = { id: nanoid(8), screenId: body.screenId, position: playlist.items.length };
    playlist.items.push(item);
    await state.set({ scope: SCOPE, key: id, data: playlist });
    return created(item);
  }, "Add screen to playlist");

  useApi("playlists/:id", "DELETE", async (req) => {
    await state.delete({ scope: SCOPE, key: paramId(req) });
    return deleted();
  }, "Delete playlist");
}
