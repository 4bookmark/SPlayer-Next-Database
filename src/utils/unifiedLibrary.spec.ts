import { expect, it } from "vitest";
import { unifiedCoverItems } from "./unifiedLibrary";
import type { Track } from "@shared/types/player";
import type { StreamingCatalog } from "@shared/types/streaming";
const local: Track = {
  id: "local",
  source: "local",
  title: "Local",
  artists: [{ name: "Artist" }],
  album: { name: "Album" },
  duration: 1,
};
const catalog: StreamingCatalog = {
  songs: ["one", "two"].map((serverId) => ({
    ...local,
    id: `${serverId}:song`,
    source: "streaming",
    serverId,
    artists: [{ id: "artist", name: "Artist" }],
    album: { id: "album", name: "Album" },
  })),
  albums: ["one", "two"].map((serverId) => ({
    id: "album",
    serverId,
    name: "Album",
    cover: `${serverId}-cover`,
    folderPaths: ["Artist/Live/Album"],
  })),
  artists: ["one", "two"].map((serverId) => ({
    id: "artist",
    serverId,
    name: "Artist",
    avatar: `${serverId}-avatar`,
  })),
};
it.each(["album", "artist"] as const)(
  "%s 保留本地和各服务器同名资源，元数据和原始身份正确",
  (mode) => {
    const items = unifiedCoverItems(
      mode,
      [local],
      catalog,
      { local: "本地", one: "NAS 1", two: "NAS 2" },
      { artist: "local-avatar" },
    );
    expect(new Set(items.map((i) => i.id)).size).toBe(3);
    expect(items[0]).toMatchObject({ source: "local", trackCount: 1 });
    expect(items[1]).toMatchObject({
      source: "streaming",
      originalId: mode,
      serverId: "one",
      subtitle: "NAS 1",
      trackCount: 1,
      cover: mode === "artist" ? "one-avatar" : "one-cover",
    });
    expect(items[2].serverId).toBe("two");
    if (mode === "album") expect(items[1].folderPaths).toEqual(["Artist/Live/Album"]);
  },
);
it("无本地音乐也显示媒体源，删除服务器目录后不会留下卡片", () => {
  expect(unifiedCoverItems("album", [], catalog, {}, {})).toHaveLength(2);
  expect(unifiedCoverItems("artist", [], { songs: [], albums: [], artists: [] }, {}, {})).toEqual(
    [],
  );
});
