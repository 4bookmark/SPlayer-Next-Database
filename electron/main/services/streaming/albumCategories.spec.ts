import { describe, expect, it } from "vitest";
import type { Track } from "@shared/types/player";
import type { StreamingLibrarySnapshot } from "@shared/types/streaming";
import { albumFolderPaths, inferAlbumCategory } from "@shared/utils/albumCategories";
import { decorateLibrary, emptyOrganization, mergeArtistGroups } from "@shared/utils/artistGroups";

/**
 * 创建带服务端目录元数据的歌曲
 * @param libraryPath - 服务端文件路径
 * @param id - 原始歌曲 ID
 * @returns 用于验证目录聚合和媒体身份的歌曲
 */
const song = (libraryPath?: string, id = "song"): Track => ({
  id: `server:${id}`,
  originalId: id,
  source: "streaming",
  serverId: "server",
  serverRevision: 3,
  title: id,
  artists: [{ id: "b", name: "B" }],
  album: { id: "record", serverId: "server", name: "Record", artist: "B" },
  libraryPath,
  duration: 1000,
});

describe("专辑自动分类", () => {
  it.each([
    ["Soundtrack", "soundtrack"],
    ["OST", "soundtrack"],
    ["O.S.T.", "soundtrack"],
    ["电影原声", "soundtrack"],
    ["電影原聲", "soundtrack"],
    ["电视原声", "soundtrack"],
    ["電視原聲", "soundtrack"],
    ["Live at Wembley", "live"],
    ["现场", "live"],
    ["現場", "live"],
    ["演唱会", "live"],
    ["演唱會", "live"],
    ["Compilation", "compilation"],
    ["Best Of", "compilation"],
    ["Greatest Hits", "compilation"],
    ["精选", "compilation"],
    ["精選", "compilation"],
    ["合集", "compilation"],
    ["Single", "single-ep"],
    ["Record - EP", "single-ep"],
    ["单曲", "single-ep"],
    ["單曲", "single-ep"],
  ])("识别标题和目录中的 %s", (marker, expected) => {
    expect(inferAlbumCategory({ name: marker })).toBe(expected);
    expect(
      inferAlbumCategory({ name: "Record", folderPaths: [`Music/${marker}/Record/CD1`] }),
    ).toBe(expected);
  });

  it("目录标记优先于标题和曲目数，专辑自身目录优先于聚合目录", () => {
    expect(
      inferAlbumCategory({
        name: "Movie OST",
        folderPaths: ["Music/现场/Record/CD1"],
        trackCount: 1,
      }),
    ).toBe("live");
    expect(
      inferAlbumCategory({
        name: "Record Live",
        folderPaths: ["Music/Single/Record", "Music/OST/Record"],
        trackCount: 12,
      }),
    ).toBe("single-ep");
    expect(inferAlbumCategory({ name: "Live", folderPaths: ["Music/Record"], trackCount: 1 })).toBe(
      "live",
    );
  });

  it.each(["Reputation", "Believe", "Delivery", "Ghost", "Stepping", "Singlehanded"])(
    "不会将 %s 的英文子串当作分类标记",
    (name) => {
      expect(inferAlbumCategory({ name })).toBeUndefined();
      expect(inferAlbumCategory({ name, folderPaths: [`Music/${name}/CD1`] })).toBeUndefined();
      expect(inferAlbumCategory({ name, trackCount: 12 })).toBe("album");
    },
  );

  it.each([
    [1, "single-ep"],
    [6, "single-ep"],
    [7, "album"],
    [20, "album"],
    [0, undefined],
    [-1, undefined],
    [1.5, undefined],
    [NaN, undefined],
    [Infinity, undefined],
    [undefined, undefined],
  ])("只依据可靠的正整数曲目数 %s 推断分类", (trackCount, category) => {
    expect(inferAlbumCategory({ name: "Record", trackCount })).toBe(category);
  });

  it("支持单曲阈值为一和关闭数量推断，标记仍然有效", () => {
    expect(inferAlbumCategory({ name: "Record", trackCount: 1 }, 1)).toBe("single-ep");
    expect(inferAlbumCategory({ name: "Record", trackCount: 2 }, 1)).toBe("album");
    expect(inferAlbumCategory({ name: "Record", trackCount: 1 }, 0)).toBeUndefined();
    expect(inferAlbumCategory({ name: "Record", trackCount: 12 }, 0)).toBeUndefined();
    expect(inferAlbumCategory({ name: "Record EP", trackCount: 12 }, 0)).toBe("single-ep");
  });
});

describe("专辑媒体库目录元数据", () => {
  it("从文件路径提取目录并统一 Windows 分隔符，保留 CD 和父级分类目录", () => {
    const tracks = [
      song("D:\\Music\\现场\\Record\\CD1\\01.flac"),
      song("D:/Music/现场/Record/CD1/02.flac", "second"),
      song("D:/Music/现场/Record/CD2/03.flac", "third"),
    ];
    expect(albumFolderPaths(tracks).get("record")).toEqual([
      "D:/Music/现场/Record/CD1",
      "D:/Music/现场/Record/CD2",
    ]);
    expect(
      inferAlbumCategory({ name: "Record", folderPaths: albumFolderPaths(tracks).get("record") }),
    ).toBe("live");
  });

  it("只读取服务端文件目录，不读取本地播放路径或文件名中的分类标记", () => {
    expect(albumFolderPaths([{ ...song(), path: "/Music/Live/song.flac" }]).size).toBe(0);
    expect(albumFolderPaths([song("Single.flac"), song(""), song()]).size).toBe(0);
    expect(albumFolderPaths([{ ...song("/Music/Record/01.flac"), album: undefined }]).size).toBe(0);
    const folderPaths = albumFolderPaths([song("/Music/Record/Live.flac")]).get("record");
    expect(folderPaths).toEqual(["/Music/Record"]);
    expect(inferAlbumCategory({ name: "Record", folderPaths })).toBeUndefined();
  });

  it("补充目录时保留自身元数据优先级、原始快照、分组与所有媒体身份", () => {
    const snapshot: StreamingLibrarySnapshot = {
      artists: [
        { id: "a", name: "A" },
        { id: "b", name: "B" },
      ],
      songs: [song("/Music/Live/Record/01.flac")],
      albums: [
        {
          id: "record",
          serverId: "server",
          name: "Record",
          artist: "B",
          folderPaths: ["D:\\Single\\Record\\"],
        },
      ],
      playlists: [],
    };
    const original = structuredClone(snapshot);
    const result = decorateLibrary(
      snapshot,
      mergeArtistGroups(emptyOrganization(), ["a", "b"], "a"),
    );
    expect(result.albums[0]?.folderPaths).toEqual(["D:/Single/Record", "/Music/Live/Record"]);
    expect(inferAlbumCategory(result.albums[0]!)).toBe("single-ep");
    expect(result.songs[0]?.album?.folderPaths).toEqual(["/Music/Live/Record"]);
    expect(result.artists).toEqual([{ id: "a", name: "A" }]);
    expect(result.songs[0]?.artists).toEqual([{ id: "a", name: "A" }]);
    expect(result.songs[0]).toMatchObject({
      id: "server:song",
      originalId: "song",
      serverId: "server",
      serverRevision: 3,
      libraryPath: "/Music/Live/Record/01.flac",
      album: { id: "record", serverId: "server" },
    });
    expect(result.songs[0]?.path).toBeUndefined();
    expect(result.albums[0]).toMatchObject({ id: "record", serverId: "server", artist: "A" });
    expect(snapshot).toEqual(original);
    expect(decorateLibrary(snapshot, emptyOrganization()).songs[0]?.artists[0]?.id).toBe("b");
  });
});
