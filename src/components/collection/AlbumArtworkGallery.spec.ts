import { flushPromises, mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { beforeEach, describe, expect, it, vi } from "vitest";
import english from "@/i18n/locales/en-US.json";
import AlbumArtworkGallery from "./AlbumArtworkGallery.vue";
import type { AlbumArtwork } from "@shared/types/streaming";

vi.mock("@/composables/useToast", () => ({ toast: { error: vi.fn() } }));
const pictures: AlbumArtwork[] = [
  {
    id: "cover",
    name: "cover.jpg",
    thumbnail: "cache://cover.jpg",
    original: "streaming-cover://artwork?token=cover",
  },
  {
    id: "back",
    name: "back.jpg",
    thumbnail: "cache://back.jpg",
    original: "streaming-cover://artwork?token=back",
  },
];
const i18n = createI18n({ legacy: false, locale: "en", messages: { en: english } });
const global = {
  plugins: [i18n],
  stubs: {
    DetailCover: { props: ["src"], template: "<div :data-main-cover='src' />" },
    SDialog: { props: ["open"], template: "<div v-if='open' role='dialog'><slot /></div>" },
    SButton: { template: "<button><slot /><slot name='icon' /></button>" },
    SImg: true,
  },
};
beforeEach(() => {
  Object.assign(window, {
    api: {
      streaming: {
        getAlbumArtworks: vi.fn(async () => pictures),
        getSnapshot: vi.fn(async () => ({
          albums: [{ id: "album", cover: "server-default.jpg" }],
        })),
        getAlbumArtworkStatus: vi.fn(async () => ({ found: 2, unavailable: [] as string[] })),
        setAlbumArtwork: vi.fn(async (_server, _album, id) =>
          pictures.map((picture) => ({ ...picture, selected: picture.id === id })),
        ),
      },
    },
  });
});

describe("专辑多封面", () => {
  it("扩展离线时可以主动恢复默认，详情使用本地快照的原始封面", async () => {
    vi.mocked(window.api.streaming.getAlbumArtworks).mockResolvedValue([]);
    vi.mocked(window.api.streaming.getAlbumArtworkStatus).mockResolvedValue({
      found: 0,
      unavailable: [],
      error: "request-failed",
    });
    const wrapper = mount(AlbumArtworkGallery, {
      props: {
        serverId: "server",
        albumId: "album",
        src: "streaming-cover://album-artwork?old",
        alt: "Album",
      },
      global,
    });
    await flushPromises();
    await wrapper.find("button").trigger("click");
    await flushPromises();
    await wrapper
      .findAll("button")
      .find((button) => button.text() === english.artwork.restoreDefault)!
      .trigger("click");
    await flushPromises();
    expect(window.api.streaming.setAlbumArtwork).toHaveBeenCalledWith("server", "album", "");
    expect(wrapper.emitted("saved")?.[0]).toEqual(["server-default.jpg"]);
    expect(wrapper.find("[data-main-cover]").attributes("data-main-cover")).toBe(
      "server-default.jpg",
    );
  });

  it.each(["extension-unavailable", "request-failed", "auth-failed", undefined] as const)(
    "%s 状态下确认不能意外清除已选封面",
    async (error) => {
      vi.mocked(window.api.streaming.getAlbumArtworks).mockResolvedValue([]);
      vi.mocked(window.api.streaming.getAlbumArtworkStatus).mockResolvedValue({
        found: 0,
        unavailable: [],
        error,
      });
      const wrapper = mount(AlbumArtworkGallery, {
        props: {
          serverId: "server",
          albumId: "album",
          src: "streaming-cover://album-artwork?selected",
          alt: "Album",
        },
        global,
      });
      await flushPromises();
      await wrapper.find("button").trigger("click");
      await flushPromises();
      const confirm = wrapper
        .findAll("button")
        .find((button) => button.text() === english.common.confirm)!;
      expect(confirm.attributes("disabled")).toBeDefined();
      await confirm.trigger("click");
      expect(window.api.streaming.setAlbumArtwork).not.toHaveBeenCalled();
      expect(wrapper.emitted("saved")).toBeUndefined();
    },
  );

  it("浏览图片不改变主封面，确认后才保存并同步显示", async () => {
    const wrapper = mount(AlbumArtworkGallery, {
      props: { serverId: "server", albumId: "album", src: "fallback.jpg", alt: "Album" },
      global,
    });
    await flushPromises();
    expect(wrapper.find("[data-main-cover]").attributes("data-main-cover")).toBe("fallback.jpg");
    expect(wrapper.find("[role=dialog]").exists()).toBe(false);
    await wrapper.find("button").trigger("click");
    expect(wrapper.find("[role=dialog] img").attributes("src")).toContain("token=cover");
    await wrapper.find('[aria-label="Next artwork"]').trigger("click");
    expect(wrapper.find("[role=dialog] img").attributes("src")).toContain("token=back");
    expect(wrapper.find("[data-main-cover]").attributes("data-main-cover")).toBe("fallback.jpg");
    expect(window.api.streaming.setAlbumArtwork).not.toHaveBeenCalled();
    await wrapper
      .findAll("button")
      .find((button) => button.text() === english.common.confirm)!
      .trigger("click");
    await flushPromises();
    expect(window.api.streaming.setAlbumArtwork).toHaveBeenCalledWith("server", "album", "back");
    expect(wrapper.find("[data-main-cover]").attributes("data-main-cover")).toBe(
      "cache://back.jpg",
    );
    expect(wrapper.emitted("saved")?.[0]).toEqual(["cache://back.jpg"]);
    expect(wrapper.find("[role=dialog]").exists()).toBe(false);
  });

  it("切换专辑后忽略上一个专辑的迟到图片清单", async () => {
    let finish!: (value: AlbumArtwork[]) => void;
    vi.mocked(window.api.streaming.getAlbumArtworks).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const wrapper = mount(AlbumArtworkGallery, {
      props: { serverId: "server", albumId: "old", src: "fallback.jpg", alt: "Album" },
      global,
    });
    await wrapper.setProps({ albumId: "new" });
    await flushPromises();
    finish([{ id: "old", name: "Old", thumbnail: "cache://old", original: "cache://old" }]);
    await flushPromises();
    expect(wrapper.find("[data-main-cover]").attributes("data-main-cover")).toBe("fallback.jpg");
  });
  it("服务器兜底封面使用同一个封面 ID，不能把专辑缩略图与另一张歌曲原图混用", async () => {
    vi.mocked(window.api.streaming.getAlbumArtworks).mockResolvedValue([]);
    const wrapper = mount(AlbumArtworkGallery, {
      props: {
        serverId: "server",
        albumId: "album",
        src: "streaming-cover://image?serverId=server&coverId=actual&size=300",
        original: "streaming-cover://image?coverId=different&size=1500",
        alt: "Album",
      },
      global,
    });
    await flushPromises();
    await wrapper.find("button").trigger("click");
    const original = new URL(wrapper.find("[role=dialog] img").attributes("src")!);
    expect(original.searchParams.get("coverId")).toBe("actual");
    expect(original.searchParams.get("size")).toBe("1500");
  });
  it("服务器兜底不显示误导性的1/1，右侧列出真实目录图片和读取失败原因", async () => {
    vi.mocked(window.api.streaming.getAlbumArtworks).mockResolvedValue([]);
    vi.mocked(window.api.streaming.getAlbumArtworkStatus).mockResolvedValue({
      found: 3,
      unavailable: [
        "cover.jpg",
        "cover (Common Version).jpg",
        "cover (Tenth Anniversary Edition).jpg",
      ],
    });
    const wrapper = mount(AlbumArtworkGallery, {
      props: { serverId: "server", albumId: "album", src: "fallback.jpg", alt: "Album" },
      global,
    });
    await flushPromises();
    await wrapper.find("button").trigger("click");
    expect(wrapper.find("aside").text()).toContain("3 images in album folder");
    expect(wrapper.find("aside").text()).toContain("cover (Common Version).jpg");
    expect(wrapper.find("aside").text()).toContain("Image unavailable");
    expect(wrapper.find("[role=dialog]").text()).not.toContain("1 / 1");
  });
});
