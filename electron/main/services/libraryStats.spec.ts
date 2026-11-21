// @vitest-environment node
import { expect, it, vi } from "vitest";
vi.mock("@main/database", () => ({
  getLibraryStats: () => ({
    trackCount: 1,
    albumCount: 1,
    artistCount: 1,
    totalDurationMs: 1000,
    totalFileSize: 500,
    codecs: [{ codec: "FLAC", count: 1 }],
  }),
}));
vi.mock("./streaming/library", () => ({
  getStreamingCatalog: () => ({
    songs: [{ duration: 2000, fileSize: 600, quality: { codec: "flac" } }, { duration: 3000 }],
    albums: [
      { id: "album", serverId: "one" },
      { id: "album", serverId: "two" },
    ],
    artists: [{ id: "merged", serverId: "one" }],
  }),
}));
import { getUnifiedLibraryStats } from "./libraryStats";
it("统计全部媒体源与本地内容，使用整理后艺术家数量且标明未知大小", () => {
  expect(getUnifiedLibraryStats()).toEqual({
    trackCount: 3,
    albumCount: 3,
    artistCount: 2,
    totalDurationMs: 6000,
    totalFileSize: 1100,
    unknownFileSizeCount: 1,
    codecs: [
      { codec: "flac", count: 2 },
      { codec: "", count: 1 },
    ],
  });
});
