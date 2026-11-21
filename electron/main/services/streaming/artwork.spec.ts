// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { emptyOrganization, getAlbumArtworkCover } from "@shared/utils/artistGroups";
import { StreamingRequestError } from "./errors";
import type { AlbumArtworkChoice } from "@shared/types/streaming";
const state = vi.hoisted(() => ({
  revision: 0,
  exists: true,
  choices: {} as Record<string, AlbumArtworkChoice>,
  list: vi.fn(),
  url: vi.fn(),
  notify: vi.fn(),
  fetch: vi.fn(),
}));
vi.mock("electron", () => ({ net: { fetch: state.fetch } }));
vi.mock("@main/database/streaming/albums", () => ({
  hasAlbum: (_server: string, id: string) => id === "album",
}));
vi.mock("./config", () => ({
  getStreamingConfig: () => ({
    servers: state.exists ? [{ id: "server", mediaRevision: state.revision }] : [],
  }),
}));
vi.mock("@main/utils/broadcast", () => ({ sendToMain: state.notify }));
vi.mock("./organization", () => ({
  getOrganization: () => ({ albumArtworkChoices: state.choices, artworkRoot: "/inaccessible-smb" }),
  setAlbumArtworkChoice: (_server: string, album: string, choice?: AlbumArtworkChoice) => {
    if (choice) state.choices[album] = choice;
    else delete state.choices[album];
  },
}));
vi.mock("./connection", () => ({
  withStreamingAdapter: async (
    _server: string,
    callback: (config: object, adapter: object) => unknown,
  ) => callback({}, { getAlbumArtworks: state.list, getAlbumArtworkUrl: state.url }),
}));
import {
  getAlbumArtworks,
  getAlbumArtworkStatus,
  setAlbumArtwork,
  handleArtworkRequest,
} from "./artwork";
const image = { id: "a".repeat(64), name: "cover.jpg", version: "v1" };
beforeEach(() => {
  state.revision++;
  state.exists = true;
  state.choices = {};
  state.list
    .mockReset()
    .mockResolvedValue([image, { ...image, id: "b".repeat(64), name: "back.jpg" }]);
  state.url.mockReset().mockResolvedValue("http://nas/rest/getAlbumArtwork?t=secret");
  state.fetch
    .mockReset()
    .mockResolvedValue(
      new Response(new Uint8Array([255, 216, 255]), { headers: { "content-type": "image/jpeg" } }),
    );
  state.notify.mockClear();
});
describe("gonic HTTP 多封面", () => {
  it("不需要本机挂载，返回不含凭据的缩略图及原图代理地址", async () => {
    const pictures = await getAlbumArtworks("server", "album");
    expect(pictures).toHaveLength(2);
    expect(pictures[0].name).toBe("cover.jpg");
    expect(pictures[0].thumbnail).toContain("size=300");
    expect(pictures[0].original).not.toContain("size=");
    expect(JSON.stringify(pictures)).not.toMatch(/secret|inaccessible-smb/);
    expect(await getAlbumArtworkStatus("server", "album")).toEqual({ found: 2, unavailable: [] });
  });
  it("确认后保存稳定的远端 ID，重新读取及列表使用相同主封面", async () => {
    const pictures = await setAlbumArtwork("server", "album", "b".repeat(64));
    expect(pictures[1].selected).toBe(true);
    expect(state.choices.album.source).toBe("gonic-http");
    expect((await getAlbumArtworks("server", "album"))[1].selected).toBe(true);
    expect(
      getAlbumArtworkCover({ ...emptyOrganization(), albumArtworkChoices: state.choices }, "album"),
    ).toBe(pictures[1].thumbnail);
  });
  it("未安装扩展和网络失败分别提示，均不删除已选图片", async () => {
    await setAlbumArtwork("server", "album", image.id);
    state.list.mockResolvedValueOnce(undefined);
    expect(await getAlbumArtworks("server", "album")).toEqual([]);
    expect((await getAlbumArtworkStatus("server", "album")).error).toBe("extension-unavailable");
    expect(state.choices.album).toBeDefined();
    state.list.mockRejectedValueOnce(new Error("network"));
    expect(await getAlbumArtworks("server", "album")).toEqual([]);
    expect((await getAlbumArtworkStatus("server", "album")).error).toBe("request-failed");
    expect(state.choices.album).toBeDefined();
  });
  it("有界清单不包含已选图片时仍保留，防止暂时不可读导致选择丢失", async () => {
    await setAlbumArtwork("server", "album", image.id);
    state.list.mockResolvedValue([]);
    await getAlbumArtworks("server", "album");
    expect(state.choices.album).toBeDefined();
    await expect(setAlbumArtwork("server", "album", image.id)).rejects.toThrow();
  });
  it("取消选择即使扩展离线也能恢复服务端默认", async () => {
    await setAlbumArtwork("server", "album", image.id);
    state.list.mockRejectedValue(new Error("offline"));
    await setAlbumArtwork("server", "album", "");
    expect(state.choices.album).toBeUndefined();
  });
  it("原图经主进程附加鉴权，仅接受当前服务器身份下的合法图片 ID", async () => {
    const [picture] = await getAlbumArtworks("server", "album");
    const response = await handleArtworkRequest(new Request(picture.original));
    expect(response.status).toBe(200);
    expect(state.url).toHaveBeenCalledWith({}, "album", image.id, undefined);
    state.revision++;
    expect((await handleArtworkRequest(new Request(picture.original))).status).toBe(404);
    expect(
      (
        await handleArtworkRequest(
          new Request(
            "streaming-cover://album-artwork?serverId=server&albumId=album&artworkId=../passwd",
          ),
        )
      ).status,
    ).toBe(404);
  });
  it("鉴权失败与网络故障分别提示，保留原有选择", async () => {
    await setAlbumArtwork("server", "album", image.id);
    state.list.mockRejectedValueOnce(new StreamingRequestError("wrong password", undefined, 40));
    expect(await getAlbumArtworks("server", "album")).toEqual([]);
    expect((await getAlbumArtworkStatus("server", "album")).error).toBe("auth-failed");
    expect(state.choices.album).toBeDefined();
  });
  it("不属于曲库的专辑不能调用远程图片接口", async () => {
    expect(await getAlbumArtworks("server", "foreign")).toEqual([]);
    await expect(setAlbumArtwork("server", "foreign", image.id)).rejects.toThrow();
    expect(state.list).not.toHaveBeenCalled();
  });
  it("旧版挂载选择不再污染新封面", () => {
    expect(
      getAlbumArtworkCover(
        {
          ...emptyOrganization(),
          artworkRoot: "/smb",
          albumArtworkChoices: {
            album: { id: "old", file: "/smb/cover.jpg", thumbnail: "cache://old", root: "/smb" },
          },
        },
        "album",
      ),
    ).toBeUndefined();
  });
  it("服务器身份变化后的迟到清单不得覆盖新状态", async () => {
    state.list.mockImplementationOnce(async () => {
      state.revision++;
      return [image];
    });
    expect(await getAlbumArtworks("server", "album")).toEqual([]);
    expect((await getAlbumArtworkStatus("server", "album")).error).toBeDefined();
  });
});
