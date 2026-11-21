import { describe, expect, it } from "vitest";
import {
  mergeArtistGroups,
  resolveArtistId,
  decorateLibrary,
  artistCategoryId,
} from "@shared/utils/artistGroups";
import type { StreamingOrganization } from "@shared/types/streaming";

const empty = (): StreamingOrganization => ({
  artistGroups: [],
  categories: [],
  albumCategories: {},
});

describe("本地歌手合并", () => {
  it("连续合并切换目标只改变展示分类，不修改成员分类或歌手分类定义", () => {
    const original = {
      ...empty(),
      artistCategoryDefinitions: [
        { id: "cn", name: "华语" },
        { id: "jp", name: "日韩" },
      ],
      artistCategories: { a: "cn", b: "jp" },
    };
    const first = mergeArtistGroups(original, ["a", "b"], "a");
    expect(artistCategoryId(first, "b")).toBe("cn");
    const next = mergeArtistGroups(first, ["a", "c"], "c");
    expect(artistCategoryId(next, "a")).toBe("");
    expect(artistCategoryId(next, "b")).toBe("");
    expect(next.artistCategories).toEqual({ a: "cn", b: "jp" });
    expect(next.artistCategoryDefinitions).toEqual(original.artistCategoryDefinitions);
    expect(original.artistGroups).toEqual([]);
    const undone = { ...next, artistGroups: [] };
    expect(artistCategoryId(undone, "a")).toBe("cn");
    expect(artistCategoryId(undone, "b")).toBe("jp");
    expect(artistCategoryId(undone, "c")).toBe("");
    expect(artistCategoryId(empty(), "a")).toBe("");
  });
  it("合并目标必须在至少两个不同的选中歌手内", () => {
    expect(() => mergeArtistGroups(empty(), ["a", "a"], "a")).toThrow();
    expect(() => mergeArtistGroups(empty(), ["a", "b"], "c")).toThrow();
  });
  it("连续合并扁平化已有成员，保留原始专辑分类", () => {
    const first = mergeArtistGroups(
      { ...empty(), albumCategories: { record: "live" } },
      ["a", "b"],
      "a",
    );
    const next = mergeArtistGroups(first, ["a", "c"], "c");
    expect(next.artistGroups).toEqual([{ targetId: "c", memberIds: ["a", "b", "c"] }]);
    expect(resolveArtistId(next, "b")).toBe("c");
    expect(next.albumCategories).toEqual({ record: "live" });
    expect(first.artistGroups[0]?.targetId).toBe("a");
  });
  it("展示合并但原始歌曲和服务端身份保持不变，撤销可恢复", () => {
    const snapshot = {
      artists: [
        { id: "a", name: "A" },
        { id: "b", name: "B" },
      ],
      songs: [
        {
          id: "server:song",
          originalId: "song",
          serverId: "server",
          source: "streaming" as const,
          title: "Song",
          artists: [{ id: "b", name: "B" }],
          duration: 1000,
        },
      ],
      albums: [{ id: "album", name: "Album", artist: "B", year: 2020 }],
      playlists: [],
    };
    const merged = decorateLibrary(snapshot, mergeArtistGroups(empty(), ["a", "b"], "a"));
    expect(merged.artists).toHaveLength(1);
    expect(merged.songs[0]?.artists[0]).toMatchObject({ id: "a", name: "A" });
    expect(merged.songs[0]?.originalId).toBe("song");
    expect(snapshot.songs[0]?.artists[0]?.name).toBe("B");
    expect(decorateLibrary(snapshot, empty()).artists).toHaveLength(2);
  });
});

// 服务层另测原子持久化，避免只验证内存算法
