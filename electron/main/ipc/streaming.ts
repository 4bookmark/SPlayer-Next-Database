import {
  organizeLibrary,
  getArtistMembers,
  decorateDetails,
} from "@main/services/streaming/organization";
import type { OrganizationAction } from "@shared/types/streaming";
import { sendToMain } from "@main/utils/broadcast";
import { ipcMain } from "electron";
import { isDbOpen } from "@main/database";
import {
  deleteLibraryByServer,
  getLibrarySnapshot,
  searchLibrary,
  getSavedStreamingFavorites,
  getStreamingCatalog,
} from "@main/services/streaming/library";
import {
  addStreamingServer,
  getStreamingConfig,
  getStreamingServer,
  removeStreamingServer,
  setActiveStreamingServer,
  updateStreamingServer,
} from "@main/services/streaming/config";
import {
  connectStreamingServer,
  testStreamingConnection,
  withStreamingAdapter,
} from "@main/services/streaming/connection";
import { registerStreamingCoverProtocol } from "@main/services/streaming/coverProtocol";
import { invalidateStreamingSession } from "@main/services/streaming/adapters/resolve";
import { cancelStreamingSync, queueStreamingSync } from "@main/services/streaming/sync";
import type { StreamingServerInput } from "@shared/types/streaming";
import { requestStreamingFavorite } from "@main/services/streaming/favorites";
import {
  getAlbumArtworks,
  getAlbumArtworkStatus,
  setAlbumArtwork,
} from "@main/services/streaming/artwork";
import { stopStreamingPlayer } from "./player";

/** 注册流媒体 IPC 和封面协议 */
export const registerStreamingIpc = (): void => {
  ipcMain.handle("streaming:getCatalog", getStreamingCatalog);
  ipcMain.handle("streaming:getSavedFavorites", getSavedStreamingFavorites);
  registerStreamingCoverProtocol();
  ipcMain.handle("streaming:getAlbumArtworkStatus", (_event, serverId: string, albumId: string) =>
    getAlbumArtworkStatus(serverId, albumId),
  );
  ipcMain.handle(
    "streaming:setAlbumArtwork",
    (_event, serverId: string, albumId: string, artworkId: string) =>
      setAlbumArtwork(serverId, albumId, artworkId),
  );
  ipcMain.handle("streaming:getAlbumArtworks", (_event, serverId: string, albumId: string) =>
    getAlbumArtworks(serverId, albumId),
  );
  ipcMain.handle("streaming:organize", (_event, serverId: string, action: OrganizationAction) => {
    organizeLibrary(serverId, action);
    sendToMain("streaming:libraryUpdated", serverId);
    return getLibrarySnapshot(serverId);
  });

  ipcMain.handle("streaming:loadServers", getStreamingConfig);
  ipcMain.handle("streaming:addServer", (_event, input: StreamingServerInput) =>
    addStreamingServer(input),
  );
  ipcMain.handle(
    "streaming:updateServer",
    async (_event, serverId: string, input: StreamingServerInput) => {
      const previous = getStreamingConfig().servers.find((server) => server.id === serverId);
      const identityChanged =
        previous?.type !== input.type ||
        previous?.url !== input.url.trim().replace(/\/+$/, "") ||
        previous?.username !== input.username ||
        Boolean(input.password);
      if (!identityChanged) return updateStreamingServer(serverId, input);
      cancelStreamingSync(serverId);
      await stopStreamingPlayer(serverId);
      const updated = await updateStreamingServer(serverId, input);
      invalidateStreamingSession(serverId);
      cancelStreamingSync(serverId);
      if (identityChanged && isDbOpen()) deleteLibraryByServer(serverId);
      return updated;
    },
  );
  ipcMain.handle("streaming:removeServer", async (_event, serverId: string) => {
    cancelStreamingSync(serverId);
    await stopStreamingPlayer(serverId);
    invalidateStreamingSession(serverId);
    cancelStreamingSync(serverId);
    removeStreamingServer(serverId);
    if (isDbOpen()) deleteLibraryByServer(serverId);
  });
  ipcMain.handle("streaming:setActiveServer", (_event, serverId: string | null) =>
    setActiveStreamingServer(serverId),
  );
  ipcMain.handle(
    "streaming:testConnection",
    (_event, input: StreamingServerInput, serverId?: string) =>
      testStreamingConnection(input, serverId),
  );
  ipcMain.handle("streaming:connect", (_event, serverId: string) =>
    connectStreamingServer(serverId),
  );
  ipcMain.handle("streaming:disconnect", async (_event, serverId: string) => {
    cancelStreamingSync(serverId);
    await stopStreamingPlayer(serverId);
    invalidateStreamingSession(serverId);
  });
  ipcMain.handle("streaming:getFavorite", (_event, serverId: string, trackId: string) =>
    requestStreamingFavorite(serverId, trackId),
  );
  ipcMain.handle(
    "streaming:setFavorite",
    (_event, serverId: string, trackId: string, value: boolean) =>
      requestStreamingFavorite(serverId, trackId, value),
  );
  ipcMain.handle("streaming:getSnapshot", (_event, serverId: string) =>
    getLibrarySnapshot(serverId),
  );
  ipcMain.handle("streaming:sync", async (_event, serverId: string, force = false) =>
    queueStreamingSync(await getStreamingServer(serverId), force),
  );
  ipcMain.handle("streaming:search", (_event, serverId: string, query: string) =>
    searchLibrary(serverId, query.slice(0, 200)),
  );
  ipcMain.handle("streaming:getAlbumSongs", (_event, serverId: string, albumId: string) =>
    withStreamingAdapter(
      serverId,
      async (config, adapter) =>
        decorateDetails(serverId, await adapter.getAlbumSongs(config, albumId)).songs,
    ),
  );
  ipcMain.handle("streaming:getPlaylistSongs", (_event, serverId: string, playlistId: string) =>
    withStreamingAdapter(serverId, (config, adapter) =>
      adapter
        .getPlaylistSongs(config, playlistId)
        .then((songs) => decorateDetails(serverId, songs).songs),
    ),
  );
  ipcMain.handle("streaming:getArtistAlbums", (_event, serverId: string, artistId: string) =>
    withStreamingAdapter(serverId, async (config, adapter) => {
      const albums = (
        await Promise.all(
          getArtistMembers(serverId, artistId).map((id) => adapter.getArtistAlbums(config, id)),
        )
      ).flat();
      return decorateDetails(serverId, [], [...new Map(albums.map((a) => [a.id, a])).values()])
        .albums;
    }),
  );
  ipcMain.handle("streaming:getArtistSongs", (_event, serverId: string, artistId: string) =>
    withStreamingAdapter(serverId, async (config, adapter) => {
      const songs = (
        await Promise.all(
          getArtistMembers(serverId, artistId).map((id) => adapter.getArtistSongs(config, id)),
        )
      ).flat();
      return decorateDetails(serverId, [...new Map(songs.map((a) => [a.id, a])).values()]).songs;
    }),
  );
  ipcMain.handle(
    "streaming:getLyrics",
    (_event, serverId: string, trackId: string, hint?: { artist?: string; title?: string }) =>
      withStreamingAdapter(serverId, (config, adapter) => adapter.getLyrics(config, trackId, hint)),
  );
};
