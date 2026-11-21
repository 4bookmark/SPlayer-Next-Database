import { mount } from "@vue/test-utils";
import { reactive } from "vue";
import { createI18n } from "vue-i18n";
import { beforeEach, expect, it, vi } from "vitest";
import type { StreamingCatalog } from "@shared/types/streaming";
import { emptyOrganization } from "@shared/utils/artistGroups";
import english from "@/i18n/locales/en-US.json";
import UnifiedCatalogView from "./UnifiedCatalogView.vue";
const state = vi.hoisted(() => ({
  streaming: undefined as unknown as {
    catalog: StreamingCatalog;
    servers: { id: string; name: string }[];
    refreshCatalog: ReturnType<typeof vi.fn>;
  },
  artist: vi.fn(),
  album: vi.fn(),
}));
vi.mock("@/stores/streaming", () => ({ useStreamingStore: () => state.streaming }));
vi.mock("@/utils/navigate", () => ({
  navigateToArtist: state.artist,
  navigateToAlbum: state.album,
}));
beforeEach(() => {
  state.streaming = reactive({
    catalog: {
      songs: [],
      albums: [],
      artists: [],
      organizations: {
        one: {
          ...emptyOrganization(),
          categories: [{ id: "custom", name: "Custom" }],
          albumCategories: { album: "custom" },
          artistCategoryDefinitions: [{ id: "region", name: "Region" }],
          artistCategories: { artist: "region" },
        },
        two: {
          ...emptyOrganization(),
          categories: [{ id: "custom", name: "Other" }],
          albumCategories: { album: "custom" },
        },
      },
    },
    servers: [
      { id: "one", name: "NAS 1" },
      { id: "two", name: "NAS 2" },
    ],
    refreshCatalog: vi.fn(),
  });
});
/** 挂载入口适配器并检查真实复用组件收到的原始身份和整理规则 */
const setup = (mode: "artist" | "album", ids: string[]) =>
  mount(UnifiedCatalogView, {
    props: {
      mode,
      items: ids.map((serverId) => ({
        id: `streaming:${serverId}:${mode}`,
        originalId: mode,
        source: "streaming" as const,
        serverId,
        title: `Item ${serverId}`,
        trackCount: 1,
      })),
    },
    global: {
      plugins: [createI18n({ legacy: false, locale: "en", messages: { en: english } })],
      stubs: {
        ArtistOrganization: {
          name: "ArtistOrganization",
          props: ["artists", "organization", "serverId"],
          emits: ["openArtist", "updated"],
          template: "<div/>",
        },
        AlbumOrganization: {
          name: "AlbumOrganization",
          props: ["items", "organization", "serverId"],
          emits: ["openAlbum"],
          template: "<div/>",
        },
      },
    },
  });
it.each(["artist", "album"] as const)(
  "单来源 %s 复用原整理组件，编辑和导航直接使用所属服务器原始 ID",
  async (mode) => {
    const wrapper = setup(mode, ["two"]);
    const shared = wrapper.findComponent({
      name: mode === "artist" ? "ArtistOrganization" : "AlbumOrganization",
    });
    expect(shared.props("serverId")).toBe("two");
    expect(shared.props("organization")).toEqual(state.streaming.catalog.organizations!.two);
    shared.vm.$emit(mode === "artist" ? "openArtist" : "openAlbum", { id: mode });
    expect(mode === "artist" ? state.artist : state.album).toHaveBeenCalledWith(
      "Item two",
      expect.objectContaining({
        source: "streaming" as const,
        serverId: "two",
        [mode === "artist" ? "artistId" : "albumId"]: mode,
      }),
    );
  },
);
it("多来源同名分类 ID 不会互相覆盖，汇总展示后筛选单来源可继续编辑", async () => {
  const wrapper = setup("album", ["one", "two"]);
  const shared = wrapper.findComponent({ name: "AlbumOrganization" });
  expect(shared.props("serverId")).toBeUndefined();
  expect(shared.props("organization").albumCategories).toEqual({
    "streaming:one:album": "streaming:one:custom",
    "streaming:two:album": "streaming:two:custom",
  });
  expect(shared.props("organization").categories).toHaveLength(2);
  await wrapper.setProps({
    items: [
      {
        id: "streaming:one:album",
        originalId: "album",
        serverId: "one",
        source: "streaming" as const,
        title: "One",
        trackCount: 1,
      },
    ],
  });
  expect(shared.props("serverId")).toBe("one");
  expect(shared.props("items")[0].id).toBe("album");
});
