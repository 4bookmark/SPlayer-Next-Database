// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { subsonicAdapter } from "./subsonic";
import type { StreamingRuntimeConfig } from "@shared/types/streaming";
const config = {
  id: "nas",
  type: "gonic",
  url: "http://nas/prefix",
  username: "user",
  password: "test-secret",
} as StreamingRuntimeConfig;
const fetchMock = vi.fn();
const picture = { id: "a".repeat(64), name: "cover.jpg", version: "v1" };
/** 构造 Subsonic JSON 响应 */
const response = (value: object): Response =>
  new Response(JSON.stringify({ "subsonic-response": { status: "ok", ...value } }));
beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
});
describe("Subsonic 多封面扩展", () => {
  it("发现 v1 扩展后带令牌请求专辑清单，不将服务端多余 URL 传给渲染进程", async () => {
    fetchMock
      .mockResolvedValueOnce(
        response({ openSubsonicExtensions: [{ name: "splayerAlbumArtworks", versions: [1] }] }),
      )
      .mockResolvedValueOnce(
        response({ albumArtworks: { artwork: [{ ...picture, url: "http://evil" }] } }),
      );
    expect(await subsonicAdapter.getAlbumArtworks!(config, "al-1")).toEqual([picture]);
    const url = new URL(fetchMock.mock.calls[1][0]);
    expect(url.pathname).toBe("/prefix/rest/getAlbumArtworks");
    expect(url.searchParams.get("id")).toBe("al-1");
    expect(url.searchParams.get("u")).toBe("user");
    expect(url.searchParams.get("t")).toMatch(/^[a-f0-9]{32}$/);
    expect(url.searchParams.has("p")).toBe(false);
  });
  it("未安装扩展时返回 undefined 且不调用清单接口", async () => {
    fetchMock.mockResolvedValue(response({ openSubsonicExtensions: [] }));
    expect(await subsonicAdapter.getAlbumArtworks!(config, "al-1")).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("鉴权失败不能伪装为未安装扩展", async () => {
    fetchMock.mockResolvedValue(
      response({ status: "failed", error: { code: 40, message: "Invalid credentials" } }),
    );
    await expect(subsonicAdapter.getAlbumArtworks!(config, "al-1")).rejects.toMatchObject({
      code: 40,
    });
  });
  it.each(
    [
      [{ ...picture, id: "../passwd" }],
      Array(65).fill(picture),
      [picture, picture],
      [{ ...picture, name: 1 }],
    ].map((pictures) => ({ pictures })),
  )("拒绝无效或超出限制的图片列表", async ({ pictures }) => {
    fetchMock
      .mockResolvedValueOnce(
        response({ openSubsonicExtensions: [{ name: "splayerAlbumArtworks", versions: [1] }] }),
      )
      .mockResolvedValueOnce(response({ albumArtworks: { artwork: pictures } }));
    await expect(subsonicAdapter.getAlbumArtworks!(config, "al-1")).rejects.toThrow();
  });
  it("图片使用同服务器地址和现有鉴权，省略 size 时请求原图", async () => {
    const thumb = new URL(
      await subsonicAdapter.getAlbumArtworkUrl!(config, "al-1", picture.id, 300),
    );
    const original = new URL(await subsonicAdapter.getAlbumArtworkUrl!(config, "al-1", picture.id));
    expect(thumb.pathname).toBe("/prefix/rest/getAlbumArtwork");
    expect(thumb.searchParams.get("size")).toBe("300");
    expect(original.searchParams.has("size")).toBe(false);
    expect(original.searchParams.get("artworkId")).toBe(picture.id);
    expect(original.href).not.toContain("test-secret");
  });
});
