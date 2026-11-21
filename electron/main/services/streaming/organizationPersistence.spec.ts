// @vitest-environment node
import { beforeEach, afterAll, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { artistCategoryId, decorateLibrary } from "@shared/utils/artistGroups";
const fixture = vi.hoisted(() => ({ directory: "" }));
vi.mock("@main/utils/paths", () => ({
  get configDir() {
    return fixture.directory;
  },
}));
vi.mock("@main/database/streaming/artists", () => ({
  getArtists: (serverId: string) =>
    serverId === "two"
      ? [{ id: "two-only", name: "Other" }]
      : [
          { id: "a", name: "A" },
          { id: "b", name: "B" },
        ],
}));
vi.mock("@main/database/streaming/albums", () => ({
  getAlbums: () => [{ id: "record", name: "Record" }],
}));
vi.mock("./config", () => ({
  getStreamingConfig: () => ({ servers: [{ id: "one" }, { id: "two" }] }),
}));
const directories: string[] = [];
beforeEach(() => {
  vi.resetModules();
  fixture.directory = fs.mkdtempSync(path.join(os.tmpdir(), "splayer-org-"));
  directories.push(fixture.directory);
});
afterAll(() => directories.forEach((d) => fs.rmSync(d, { recursive: true, force: true })));
describe("整理规则持久化与隔离", () => {
  it("专辑与歌手收藏服务器隔离，重载持久保存，可取消且拒绝外库对象", async () => {
    const service = await import("./organization");
    service.organizeLibrary("one", { type: "favorite-album", id: "record", favorite: true });
    service.organizeLibrary("one", { type: "favorite-artist", id: "a", favorite: true });
    vi.resetModules();
    const reloaded = await import("./organization");
    expect(reloaded.getOrganization("one").favoriteAlbumIds).toEqual(["record"]);
    expect(reloaded.getOrganization("one").favoriteArtistIds).toEqual(["a"]);
    expect(reloaded.getOrganization("two").favoriteAlbumIds).toBeUndefined();
    expect(() =>
      reloaded.organizeLibrary("two", { type: "favorite-artist", id: "a", favorite: true }),
    ).toThrow();
    reloaded.organizeLibrary("one", { type: "favorite-album", id: "record", favorite: false });
    expect(reloaded.getOrganization("one").favoriteAlbumIds).toEqual([]);
    reloaded.clearOrganization("one");
    expect(reloaded.getOrganization("one").favoriteArtistIds).toBeUndefined();
  });
  it("合并后的歌手取消收藏会清除原成员的收藏引用", async () => {
    const service = await import("./organization");
    service.organizeLibrary("one", { type: "favorite-artist", id: "b", favorite: true });
    service.organizeLibrary("one", { type: "merge", selectedIds: ["a", "b"], targetId: "a" });
    service.organizeLibrary("one", { type: "favorite-artist", id: "a", favorite: false });
    expect(service.getOrganization("one").favoriteArtistIds).toEqual([]);
  });
  it("专辑封面选择重启后保留，服务器隔离且清除身份时移除", async () => {
    const service = await import("./organization");
    service.setArtworkRoot("one", "/mounted/music");
    const choice = {
      source: "gonic-http" as const,
      file: "stable",
      thumbnail: "streaming-cover://album-artwork?serverId=one&albumId=record&artworkId=stable",
      id: "stable",
      root: "gonic-http",
    };
    service.setAlbumArtworkChoice("one", "record", choice);
    vi.resetModules();
    const reloaded = await import("./organization");
    expect(reloaded.getOrganization("one").albumArtworkChoices?.record).toEqual(choice);
    expect(reloaded.getOrganization("two").albumArtworkChoices).toBeUndefined();
    const album = { id: "record", name: "Record", cover: "remote" };
    expect(reloaded.decorateDetails("one", [], [album]).albums[0]?.cover).toBe(choice.thumbnail);
    expect(reloaded.decorateDetails("two", [], [album]).albums[0]?.cover).toBe("remote");
    reloaded.setAlbumArtworkChoice("one", "record");
    expect(reloaded.getOrganization("one").albumArtworkChoices?.record).toBeUndefined();
    reloaded.setAlbumArtworkChoice("one", "record", choice);
    reloaded.clearOrganization("one");
    expect(reloaded.getOrganization("one").albumArtworkChoices).toBeUndefined();
  });

  it("旧整理文件可添加歌手分类，重载后独立保存分类和挂载目录", async () => {
    fs.writeFileSync(
      path.join(fixture.directory, "streaming-organization.json"),
      JSON.stringify({
        one: {
          artistGroups: [],
          categories: [],
          albumCategories: {},
          artworkRoot: "/mounted/music",
        },
      }),
    );
    const service = await import("./organization");
    service.organizeLibrary("one", { type: "artist-category-create", name: "  华语  " });
    const id = service.getOrganization("one").artistCategoryDefinitions![0]!.id;
    service.organizeLibrary("one", {
      type: "artist-classify",
      artistIds: ["a", "b"],
      categoryId: id,
    });
    vi.resetModules();
    const reloaded = await import("./organization");
    expect(reloaded.getOrganization("one")).toMatchObject({
      artistCategoryDefinitions: [{ id, name: "华语" }],
      artistCategories: { a: id, b: id },
      artworkRoot: "/mounted/music",
      categories: [],
      albumCategories: {},
    });
    expect(reloaded.getOrganization("two").artistCategoryDefinitions).toBeUndefined();
    expect(reloaded.getOrganization("two").artistCategories).toBeUndefined();
    reloaded.clearOrganization("one");
    expect(reloaded.getOrganization("one").artistCategoryDefinitions).toBeUndefined();
    expect(reloaded.getOrganization("one").artistCategories).toBeUndefined();
    expect(reloaded.getOrganization("one").artworkRoot).toBeUndefined();
  });

  it("歌手分类创建和重命名校验长度、去空白及大小写重复，专辑分类可同名", async () => {
    const service = await import("./organization");
    service.organizeLibrary("one", { type: "category-create", name: "Western" });
    service.organizeLibrary("one", { type: "artist-category-create", name: " Western " });
    const first = service.getOrganization("one").artistCategoryDefinitions![0]!.id;
    for (const name of ["", "  ", "a".repeat(61), "WESTERN", " western "]) {
      expect(() =>
        service.organizeLibrary("one", { type: "artist-category-create", name }),
      ).toThrow();
    }
    service.organizeLibrary("one", { type: "artist-category-create", name: "华语" });
    const second = service.getOrganization("one").artistCategoryDefinitions![1]!.id;
    expect(() =>
      service.organizeLibrary("one", {
        type: "artist-category-rename",
        id: second,
        name: "western",
      }),
    ).toThrow();
    expect(() =>
      service.organizeLibrary("one", { type: "artist-category-rename", id: second, name: " " }),
    ).toThrow();
    expect(() =>
      service.organizeLibrary("one", {
        type: "artist-category-rename",
        id: second,
        name: "a".repeat(61),
      }),
    ).toThrow();
    service.organizeLibrary("one", {
      type: "artist-category-rename",
      id: first,
      name: " WESTERN ",
    });
    service.organizeLibrary("one", {
      type: "artist-category-rename",
      id: second,
      name: "  日韩  ",
    });
    service.organizeLibrary("one", { type: "artist-category-create", name: "a".repeat(60) });
    expect(service.getOrganization("one").artistCategoryDefinitions!.map((c) => c.name)).toEqual([
      "WESTERN",
      "日韩",
      "a".repeat(60),
    ]);
    expect(service.getOrganization("one").categories[0]!.name).toBe("Western");
  });

  it("歌手分类只接受本服务器原始歌手和分类 ID，未分类会移除原始记录", async () => {
    const service = await import("./organization");
    service.organizeLibrary("one", { type: "artist-category-create", name: "华语" });
    const id = service.getOrganization("one").artistCategoryDefinitions![0]!.id;
    service.organizeLibrary("two", { type: "artist-category-create", name: "华语" });
    const otherId = service.getOrganization("two").artistCategoryDefinitions![0]!.id;
    service.organizeLibrary("one", { type: "category-create", name: "专辑专用" });
    const albumId = service.getOrganization("one").categories[0]!.id;
    for (const artistIds of [["two-only"], ["one:a"], ["missing"], ["a", "two-only"]]) {
      expect(() =>
        service.organizeLibrary("one", { type: "artist-classify", artistIds, categoryId: id }),
      ).toThrow();
    }
    for (const categoryId of [otherId, albumId, "live", "missing"]) {
      expect(() =>
        service.organizeLibrary("one", { type: "artist-classify", artistIds: ["a"], categoryId }),
      ).toThrow();
    }
    expect(() =>
      service.organizeLibrary("missing", { type: "artist-category-create", name: "华语" }),
    ).toThrow();
    expect(() =>
      service.organizeLibrary("one", {
        type: "artist-category-rename",
        id: "missing",
        name: "华语",
      }),
    ).toThrow();
    expect(() =>
      service.organizeLibrary("one", { type: "artist-category-delete", id: "missing" }),
    ).toThrow();
    service.organizeLibrary("one", {
      type: "artist-classify",
      artistIds: ["a", "b"],
      categoryId: id,
    });
    service.organizeLibrary("one", { type: "artist-classify", artistIds: ["a"], categoryId: "" });
    expect(service.getOrganization("one").artistCategories).toEqual({ b: id });
    service.organizeLibrary("two", {
      type: "artist-classify",
      artistIds: ["two-only"],
      categoryId: otherId,
    });
    expect(service.getOrganization("two").artistCategories).toEqual({ "two-only": otherId });
    expect(service.getOrganization("one").artistCategories).toEqual({ b: id });
  });

  it("合并展示目标分类，隐藏成员分类独立保存，撤销与重载恢复各自分类", async () => {
    const service = await import("./organization");
    for (const name of ["华语", "日韩"])
      service.organizeLibrary("one", { type: "artist-category-create", name });
    const [first, second] = service.getOrganization("one").artistCategoryDefinitions!;
    service.organizeLibrary("one", {
      type: "artist-classify",
      artistIds: ["a"],
      categoryId: first!.id,
    });
    service.organizeLibrary("one", {
      type: "artist-classify",
      artistIds: ["b"],
      categoryId: second!.id,
    });
    service.organizeLibrary("one", { type: "merge", selectedIds: ["a", "b"], targetId: "a" });
    const merged = service.getOrganization("one");
    expect(artistCategoryId(merged, "a")).toBe(first!.id);
    expect(artistCategoryId(merged, "b")).toBe(first!.id);
    expect(merged.artistCategories).toEqual({ a: first!.id, b: second!.id });
    expect(
      decorateLibrary(
        {
          artists: [
            { id: "a", name: "A" },
            { id: "b", name: "B" },
          ],
          albums: [],
          songs: [],
          playlists: [],
        },
        merged,
      ).artists.map((a) => a.id),
    ).toEqual(["a"]);
    service.organizeLibrary("one", { type: "unmerge", targetId: "a" });
    vi.resetModules();
    const reloaded = await import("./organization");
    expect(artistCategoryId(reloaded.getOrganization("one"), "a")).toBe(first!.id);
    expect(artistCategoryId(reloaded.getOrganization("one"), "b")).toBe(second!.id);
    expect(reloaded.getOrganization("one").artistGroups).toEqual([]);
  });

  it("删除歌手分类仅清除其原始歌手记录，不影响同名专辑分类与其他歌手分类", async () => {
    const service = await import("./organization");
    service.organizeLibrary("one", { type: "category-create", name: "华语" });
    const albumId = service.getOrganization("one").categories[0]!.id;
    service.organizeLibrary("one", { type: "classify", albumIds: ["record"], categoryId: albumId });
    for (const name of ["华语", "日韩"])
      service.organizeLibrary("one", { type: "artist-category-create", name });
    const [first, second] = service.getOrganization("one").artistCategoryDefinitions!;
    service.organizeLibrary("one", {
      type: "artist-classify",
      artistIds: ["a"],
      categoryId: first!.id,
    });
    service.organizeLibrary("one", {
      type: "artist-classify",
      artistIds: ["b"],
      categoryId: second!.id,
    });
    service.organizeLibrary("one", { type: "artist-category-delete", id: first!.id });
    const result = service.getOrganization("one");
    expect(result.artistCategories).toEqual({ b: second!.id });
    expect(result.artistCategoryDefinitions).toEqual([second]);
    expect(result.categories).toEqual([{ id: albumId, name: "华语" }]);
    expect(result.albumCategories).toEqual({ record: albumId });
  });
  it("重读文件后保持合并和分类，其他服务器不受影响", async () => {
    const service = await import("./organization");
    service.setArtworkRoot("one", "/mounted/music");
    service.organizeLibrary("one", { type: "merge", selectedIds: ["a", "b"], targetId: "a" });
    service.organizeLibrary("one", { type: "classify", albumIds: ["record"], categoryId: "live" });
    vi.resetModules();
    const reloaded = await import("./organization");
    expect(reloaded.getOrganization("one").artistGroups[0]?.memberIds).toEqual(["a", "b"]);
    expect(reloaded.getOrganization("one").albumCategories.record).toBe("live");
    expect(reloaded.getOrganization("one").artworkRoot).toBe("/mounted/music");
    expect(reloaded.getOrganization("two").artworkRoot).toBeUndefined();
    expect(reloaded.getOrganization("two").artistGroups).toHaveLength(0);
    reloaded.organizeLibrary("one", { type: "unmerge", targetId: "a" });
    expect(reloaded.getOrganization("one").artistGroups).toHaveLength(0);
    expect(reloaded.getOrganization("one").albumCategories.record).toBe("live");
    reloaded.clearOrganization("one");
    expect(reloaded.getOrganization("one").albumCategories).toEqual({});
    expect(reloaded.getOrganization("one").artworkRoot).toBeUndefined();
  });
  it("删除自定义分类恢复未分类，拒绝未知身份和非法分类", async () => {
    const service = await import("./organization");
    service.organizeLibrary("one", { type: "category-create", name: "原声带" });
    const id = service.getOrganization("one").categories[0]!.id;
    service.organizeLibrary("one", { type: "classify", albumIds: ["record"], categoryId: id });
    expect(() =>
      service.organizeLibrary("one", { type: "category-create", name: "原声带" }),
    ).toThrow();
    service.organizeLibrary("one", { type: "category-delete", id });
    expect(service.getOrganization("one").albumCategories.record).toBe("uncategorized");
    expect(() => service.organizeLibrary("missing", { type: "unmerge", targetId: "a" })).toThrow();
    expect(() =>
      service.organizeLibrary("one", {
        type: "classify",
        albumIds: ["missing"],
        categoryId: "live",
      }),
    ).toThrow();
  });
});
