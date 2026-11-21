// @vitest-environment node
import { expect, it, vi } from "vitest";
vi.mock("./config", () => ({
  getStreamingConfig: () => ({ servers: [{ id: "one" }, { id: "two" }] }),
}));
vi.mock("@main/database/playlists", () => ({ removeServerPlaylistTracks: vi.fn() }));
vi.mock("@main/database/streaming/tracks", () => ({
  getTracks: (id: string) => [
    {
      id: `${id}:song`,
      serverId: id,
      source: "streaming",
      favorite: true,
      artists: [],
      album: { id: "album" },
    },
    { id: `${id}:no`, serverId: id, artists: [], favorite: false },
  ],
  deleteTracksByServer: vi.fn(),
}));
vi.mock("@main/database/streaming/albums", () => ({
  getAlbums: () => [{ id: "album", name: "Album" }],
  deleteAlbumsByServer: vi.fn(),
}));
vi.mock("@main/database/streaming/artists", () => ({
  getArtists: () => [
    { id: "artist", name: "Artist" },
    { id: "alias", name: "Alias" },
  ],
  deleteArtistsByServer: vi.fn(),
}));
vi.mock("@main/database/streaming/playlists", () => ({
  getPlaylists: () => [],
  deletePlaylistsByServer: vi.fn(),
}));
vi.mock("./organization", () => ({
  clearOrganization: vi.fn(),
  getOrganization: (id: string) => ({
    artistGroups: [{ targetId: "artist", memberIds: ["artist", "alias"] }],
    categories: [],
    albumCategories: {},
    favoriteAlbumIds: id === "one" ? ["album"] : [],
    favoriteArtistIds: id === "one" ? ["alias"] : [],
  }),
}));
import { getSavedStreamingFavorites, getStreamingCatalog } from "./library";
it("汇总所有服务器的已喜欢歌曲，合集按服务器隔离且合并歌手映射为唯一目标", () => {
  const favorites = getSavedStreamingFavorites();
  expect(favorites.songs.map((song) => song.id)).toEqual(["one:song", "two:song"]);
  expect(favorites.albums.map((album) => [album.serverId, album.id])).toEqual([["one", "album"]]);
  expect(favorites.artists.map((artist) => [artist.serverId, artist.id])).toEqual([
    ["one", "artist"],
  ]);
});

it("统一目录包含未激活服务器，保留原始资源 ID 并沿用歌手合并", () => {
  const catalog = getStreamingCatalog();
  expect(catalog.songs).toHaveLength(4);
  expect(catalog.albums.map((a) => [a.serverId, a.id])).toEqual([
    ["one", "album"],
    ["two", "album"],
  ]);
  expect(catalog.artists.map((a) => [a.serverId, a.id])).toEqual([
    ["one", "artist"],
    ["two", "artist"],
  ]);
});
