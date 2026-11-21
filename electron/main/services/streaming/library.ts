import { getOrganization, clearOrganization } from "./organization";
import { decorateLibrary, resolveArtistId } from "@shared/utils/artistGroups";
import { getStreamingConfig } from "./config";
import { removeServerPlaylistTracks } from "@main/database/playlists";
import type { StreamingCatalog, StreamingSavedFavorites } from "@shared/types/streaming";
import type { StreamingLibrarySnapshot, StreamingSearchResult } from "@shared/types/streaming";
import { deleteTracksByServer, getTracks } from "@main/database/streaming/tracks";
import { deleteAlbumsByServer, getAlbums } from "@main/database/streaming/albums";
import { deleteArtistsByServer, getArtists } from "@main/database/streaming/artists";
import { deletePlaylistsByServer, getPlaylists } from "@main/database/streaming/playlists";

/** 读取全部已配置服务器的整理后目录，不依赖当前激活服务器 */
export const getStreamingCatalog = (): StreamingCatalog => {
  const result: StreamingCatalog = { songs: [], albums: [], artists: [], organizations: {} };
  for (const server of getStreamingConfig().servers) {
    const snapshot = getLibrarySnapshot(server.id);
    result.organizations![server.id] = snapshot.organization ?? getOrganization(server.id);
    result.songs.push(...snapshot.songs);
    result.albums.push(...snapshot.albums.map((album) => ({ ...album, serverId: server.id })));
    result.artists.push(...snapshot.artists.map((artist) => ({ ...artist, serverId: server.id })));
  }
  return result;
};

/** 读取各服务器已缓存的喜欢和合集收藏，包含未激活的服务器 */
export const getSavedStreamingFavorites = (): StreamingSavedFavorites => {
  const result: StreamingSavedFavorites = { songs: [], albums: [], artists: [] };
  for (const server of getStreamingConfig().servers) {
    const snapshot = getLibrarySnapshot(server.id);
    const rules = snapshot.organization ?? getOrganization(server.id);
    const albums = new Set(rules.favoriteAlbumIds ?? []);
    const artists = new Set(
      (rules.favoriteArtistIds ?? []).map((id) => resolveArtistId(rules, id)),
    );
    result.songs.push(...snapshot.songs.filter((track) => track.favorite));
    result.albums.push(
      ...snapshot.albums
        .filter((album) => album.id && albums.has(album.id))
        .map((album) => ({ ...album, serverId: server.id })),
    );
    result.artists.push(
      ...snapshot.artists
        .filter((artist) => artist.id && artists.has(artist.id))
        .map((artist) => ({ ...artist, serverId: server.id })),
    );
  }
  return result;
};

/**
 * 删除指定服务器的全部流媒体数据
 * @param serverId - 服务器 ID
 */
export const deleteLibraryByServer = (serverId: string): void => {
  removeServerPlaylistTracks(serverId);
  clearOrganization(serverId);
  deletePlaylistsByServer(serverId);
  deleteTracksByServer(serverId);
  deleteAlbumsByServer(serverId);
  deleteArtistsByServer(serverId);
};

/**
 * 读取一个服务器当前已经写入 SQLite 的完整媒体快照
 * @param serverId - 服务器 ID
 * @returns 完整媒体库快照
 */
export const getLibrarySnapshot = (serverId: string): StreamingLibrarySnapshot =>
  decorateLibrary(
    {
      songs: getTracks(serverId),
      albums: getAlbums(serverId),
      artists: getArtists(serverId),
      playlists: getPlaylists(serverId),
    },
    getOrganization(serverId),
  );

/**
 * 在 SQLite 快照中搜索歌曲、专辑和歌手
 * @param serverId - 服务器 ID
 * @param query - 搜索词
 * @returns 聚合搜索结果
 */
export const searchLibrary = (serverId: string, query: string): StreamingSearchResult => {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return { songs: [], albums: [], artists: [] };
  const snapshot = getLibrarySnapshot(serverId);
  return {
    songs: snapshot.songs.filter((song) =>
      [song.title, song.album?.name, ...song.artists.map((a) => a.name)].some((value) =>
        value?.toLocaleLowerCase().includes(needle),
      ),
    ),
    albums: snapshot.albums.filter(
      (album) =>
        album.name.toLocaleLowerCase().includes(needle) ||
        album.artist?.toLocaleLowerCase().includes(needle),
    ),
    artists: snapshot.artists.filter((artist) => artist.name.toLocaleLowerCase().includes(needle)),
  };
};
