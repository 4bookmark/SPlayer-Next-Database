import { mount, flushPromises } from "@vue/test-utils";
import { reactive } from "vue";
import type { StreamingSavedFavorites } from "@shared/types/streaming";
import { createMemoryHistory, createRouter } from "vue-router";
import { createI18n } from "vue-i18n";
import { beforeEach, describe, expect, it, vi } from "vitest";
import english from "@/i18n/locales/en-US.json";
import Liked from "./Liked.vue";
import Favorites from "./Favorites.vue";
const fixture = vi.hoisted(() => ({
  streaming: undefined as unknown as {
    savedFavorites: StreamingSavedFavorites;
    init: ReturnType<typeof vi.fn>;
    refreshSavedFavorites: ReturnType<typeof vi.fn>;
  },
  library: undefined as unknown as {
    initialized: boolean;
    tracks: { id: string; title: string }[];
    likedOrderedIds: string[];
  },
  status: undefined as unknown as { likedPageTab: string },
}));
vi.mock("@/stores/streaming", () => ({ useStreamingStore: () => fixture.streaming }));
vi.mock("@/stores/library", () => ({ useLibraryStore: () => fixture.library }));
vi.mock("@/stores/user", () => ({
  useUserStore: () => ({
    isLoggedIn: false,
    likedPlaylistTracks: [],
    subscribedPlaylists: [],
    albums: [],
    artists: [],
  }),
}));
vi.mock("@/stores/status", () => ({ useStatusStore: () => fixture.status }));
vi.mock("@/core/player", () => ({ playFrom: vi.fn() }));
beforeEach(() => {
  fixture.streaming = reactive({
    savedFavorites: {
      songs: [
        {
          id: "nas:song",
          source: "streaming",
          serverId: "nas",
          originalId: "song",
          title: "Gonic liked",
          artists: [],
          duration: 1000,
          favorite: true,
        },
      ],
      albums: [{ id: "album", serverId: "nas", name: "Saved album" }],
      artists: [{ id: "artist", serverId: "nas", name: "Saved artist" }],
    },
    init: vi.fn(async () => {}),
    refreshSavedFavorites: vi.fn(async () => {}),
  });
  fixture.library = {
    initialized: true,
    tracks: [{ id: "local", title: "Local liked" }],
    likedOrderedIds: ["local"],
  };
  fixture.status = reactive({ likedPageTab: "local" });
});
/** 创建含媒体源导航的页面测试环境 */
const setup = async (page: typeof Liked | typeof Favorites, url: string) => {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/liked", component: Liked },
      { path: "/favorites", component: Favorites },
      { path: "/collection/streaming/album/:id", component: { template: "<div/>" } },
      { path: "/artist/streaming/:id", component: { template: "<div/>" } },
    ],
  });
  await router.push(url);
  const wrapper = mount(page, {
    global: {
      plugins: [router, createI18n({ legacy: false, locale: "en", messages: { en: english } })],
      stubs: {
        SongList: {
          props: ["items"],
          template:
            "<div data-songs><span v-for='song in items' :key='song.id'>{{song.title}}</span></div>",
        },
        CoverList: {
          props: ["items"],
          emits: ["click"],
          template:
            "<div><button v-for='item in items' :key='item.id' @click='$emit(\"click\",item)'>{{item.title}}</button></div>",
        },
        SButton: { template: "<button><slot/><slot name='icon'/></button>" },
        SInput: true,
        STabs: true,
        SDropdownMenu: true,
      },
    },
  });
  await flushPromises();
  return { wrapper, router };
};
describe("媒体源收藏汇总页面", () => {
  it("无网易登录也显示Gonic喜欢，取消后列表实时移除，同时保留本地喜欢", async () => {
    const { wrapper } = await setup(Liked, "/liked");
    expect(wrapper.find("[data-songs]").text()).toContain("Gonic liked");
    expect(wrapper.text()).toContain("Local liked");
    fixture.streaming.savedFavorites.songs = [];
    await flushPromises();
    expect(wrapper.text()).not.toContain("Gonic liked");
    expect(wrapper.text()).toContain("Local liked");
  });
  it.each([
    ["album", "Saved album", "/collection/streaming/album/album"],
    ["artist", "Saved artist", "/artist/streaming/artist"],
  ])("%s收藏无需网易登录且导航携带所属服务器", async (tab, title, path) => {
    const { wrapper, router } = await setup(Favorites, `/favorites?tab=${tab}`);
    const card = wrapper.findAll("button").find((button) => button.text() === title)!;
    expect(card).toBeDefined();
    await card.trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.path).toBe(path);
    expect(router.currentRoute.value.query.serverId).toBe("nas");
  });
});
