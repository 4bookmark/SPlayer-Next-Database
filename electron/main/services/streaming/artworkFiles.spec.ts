// @vitest-environment node
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { listAlbumArtworkFiles, resolveArtworkFile } from "./artworkFiles";

let temporary: string;
let root: string;
let album: string;
beforeEach(async () => {
  temporary = await fs.mkdtemp(path.join(os.tmpdir(), "splayer-artwork-"));
  temporary = await fs.realpath(temporary);
  root = path.join(temporary, "music");
  album = path.join(root, "Artist", "Album");
  await fs.mkdir(album, { recursive: true });
});
afterEach(async () => fs.rm(temporary, { recursive: true, force: true }));

describe("专辑图片目录读取", () => {
  it("优先 cover、folder、front，按文件名排序其余图片并忽略所有子目录", async () => {
    for (const name of [
      "z.jpg",
      "cover 2.png",
      "FOLDER.png",
      "Cover.JPG",
      "Front.webp",
      "track.flac",
      "ignored.svg",
    ])
      await fs.writeFile(path.join(album, name), "image");
    await fs.mkdir(path.join(album, "Scans", "nested"), { recursive: true });
    await fs.writeFile(path.join(album, "Scans", "booklet.png"), "image");
    await fs.writeFile(path.join(album, "Scans", "nested", "hidden.jpg"), "image");
    expect(
      (await listAlbumArtworkFiles(root, ["Artist/Album/track.flac"])).map((file) =>
        path.basename(file),
      ),
    ).toEqual(["Cover.JPG", "FOLDER.png", "Front.webp", "cover 2.png", "z.jpg"]);
  });

  it("拒绝绝对路径、上级路径、盘符及目录和图片的越界符号链接", async () => {
    const outside = path.join(temporary, "outside");
    await fs.mkdir(outside);
    await fs.writeFile(path.join(outside, "cover.jpg"), "secret");
    await fs.symlink(outside, path.join(root, "escape"));
    await fs.symlink(path.join(outside, "cover.jpg"), path.join(album, "cover.jpg"));
    await fs.symlink(outside, path.join(album, "artwork"));
    for (const value of [
      "../outside/song.flac",
      path.join(outside, "song.flac"),
      "C:\\outside\\song.flac",
      "escape/song.flac",
      "Artist/Album/song.flac",
    ])
      expect(await listAlbumArtworkFiles(root, [value])).toEqual([]);
    expect(await resolveArtworkFile(root, path.join(album, "cover.jpg"))).toBeUndefined();
  });

  it("CD 目录仅读取歌曲所在目录，不读取父目录", async () => {
    await fs.mkdir(path.join(album, "CD1"));
    await fs.writeFile(path.join(album, "cover.jpg"), "image");
    expect(await listAlbumArtworkFiles(root, ["Artist/Album/CD1/song.flac"])).toEqual([]);
    await fs.writeFile(path.join(album, "CD1", "folder.png"), "disc image");
    expect(await listAlbumArtworkFiles(root, ["Artist/Album/CD1/song.flac"])).toEqual([
      path.join(album, "CD1", "folder.png"),
    ]);
    await fs.mkdir(path.join(root, "Artist", "Disc 1"));
    await fs.writeFile(path.join(root, "Artist", "cover.jpg"), "artist");
    expect(await listAlbumArtworkFiles(root, ["Artist/Disc 1/song.flac"])).toEqual([]);
  });

  it("拒绝超大图片文件，避免解码造成内存峰值", async () => {
    const file = path.join(album, "huge.jpg");
    const handle = await fs.open(file, "w");
    await handle.truncate(32 * 1024 * 1024 + 1);
    await handle.close();
    expect(await resolveArtworkFile(root, file)).toBeUndefined();
  });

  it("最多返回 64 张图片，优先封面不会被大量普通图片挤出", async () => {
    await Promise.all(
      Array.from({ length: 80 }, (_, i) => fs.writeFile(path.join(album, `a-${i}.jpg`), "image")),
    );
    await fs.writeFile(path.join(album, "cover.png"), "image");
    const result = await listAlbumArtworkFiles(root, ["Artist/Album/song.flac"]);
    expect(result).toHaveLength(64);
    expect(path.basename(result[0]!)).toBe("cover.png");
  });

  it("挂载不可用时返回空列表，图片被换成越界链接后重新校验失败", async () => {
    expect(
      await listAlbumArtworkFiles(path.join(temporary, "missing"), ["Album/song.flac"]),
    ).toEqual([]);
    const image = path.join(album, "cover.jpg");
    await fs.writeFile(image, "image");
    expect(await resolveArtworkFile(root, image)).toBe(image);
    await fs.unlink(image);
    const external = path.join(temporary, "external.jpg");
    await fs.writeFile(external, "external");
    await fs.symlink(external, image);
    expect(await resolveArtworkFile(root, image)).toBeUndefined();
  });
});
