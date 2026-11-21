import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, defineStore, setActivePinia } from "pinia";
import { ref, shallowRef } from "vue";
import { createI18n } from "vue-i18n";
import { createMemoryHistory, createRouter } from "vue-router";
import { beforeEach, expect, it, vi } from "vitest";
import type { Track } from "@shared/types/player";
import type { StreamingCatalog } from "@shared/types/streaming";
import english from "@/i18n/locales/en-US.json";
const navigate = vi.hoisted(() => ({ artist: vi.fn(), album: vi.fn() }));
vi.mock("@/utils/navigate", () => ({
  navigateToArtist: navigate.artist,
  navigateToAlbum: navigate.album,
}));
vi.mock("@/core/player", () => ({ playFrom: vi.fn() }));
vi.mock("@/stores/library", () => ({ useLibraryStore: () => localStore() }));
vi.mock("@/stores/streaming", () => ({ useStreamingStore: () => mediaStore() }));
const localStore = defineStore("unified-test-local", () => ({
  tracks: shallowRef<Track[]>([]),
  initialized: ref(true),
  artistAvatars: ref({}),
  scanDirs: ref([]),
  scanning: ref(false),
  scanProgress: ref(null),
  load: vi.fn(),
  subscribeScanProgress: vi.fn(),
  unsubscribeScanProgress: vi.fn(),
  startScan: vi.fn(),
}));
const mediaStore = defineStore("unified-test-streaming", () => ({
  servers: ref([
    { id: "one", name: "NAS 1" },
    { id: "two", name: "NAS 2" },
  ]),
  catalog: shallowRef<StreamingCatalog>({ songs: [], albums: [], artists: [] }),
  init: vi.fn(async () => {}),
  refreshCatalog: vi.fn(async () => {}),
}));
import LocalList from "./LocalList.vue";
import Library from "./Library.vue";
const song: Track = {
  id: "one:song",
  serverId: "one",
  source: "streaming",
  originalId: "song",
  title: "NAS song",
  artists: [{ id: "artist", name: "NAS artist" }],
  album: { id: "album", name: "NAS album" },
  duration: 1000,
};
beforeEach(() => {
  localStorage.removeItem("splayer-library-view");
  setActivePinia(createPinia());
  mediaStore().catalog = {
    songs: [song, { ...song, id: "two:song", serverId: "two", title: "Other NAS song" }],
    albums: [
      { id: "album", serverId: "one", name: "NAS album" },
      { id: "album", serverId: "two", name: "Other NAS album" },
    ],
    artists: [
      { id: "artist", serverId: "one", name: "NAS artist" },
      { id: "artist", serverId: "two", name: "Other NAS artist" },
    ],
  };
});
/** 挂载统一目录页，列表 stub 保留传入身份和来源筛选交互 */
const setup = async (page: typeof Library | typeof LocalList, url: string) => {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/library", name: "library", component: Library },
      { path: "/artists/local", name: "artist-list", component: LocalList },
      { path: "/albums/local", name: "album-list", component: LocalList },
    ],
  });
  await router.push(url);
  const wrapper = mount(page, {
    global: {
      plugins: [router, createI18n({ legacy: false, locale: "en", messages: { en: english } })],
      stubs: {
        UnifiedCatalogView: {
          name: "UnifiedCatalogView",
          props: ["items", "mode"],
          template:
            '<div data-catalog><span v-for="item in items" :key="item.id">{{item.title}}</span></div>',
        },
        SongList: {
          props: ["items"],
          template:
            '<div data-tracks><span v-for="item in items" :key="item.id">{{item.title}}</span></div>',
        },
        SSelect: {
          props: ["modelValue", "options"],
          emits: ["update:modelValue"],
          template:
            '<select :value="modelValue" @change="$emit(\'update:modelValue\',$event.target.value)"><option v-for="opt in options" :value="opt.value">{{opt.label}}</option></select>',
        },
        SButton: { template: '<button><slot/><slot name="icon"/></button>' },
        SInput: true,
        SDropdownMenu: true,
        SDialog: true,
      },
    },
  });
  await flushPromises();
  return wrapper;
};
it.each(["artist", "album"] as const)(
  "%s 无本地音乐也显示所有服务器，筛选和详情跳转保留原始身份",
  async (mode) => {
    const wrapper = await setup(LocalList, mode === "artist" ? "/artists/local" : "/albums/local");
    expect(wrapper.text()).toContain(`NAS ${mode}`);
    expect(wrapper.text()).toContain(`Other NAS ${mode}`);
    await wrapper.find("select").setValue("two");
    expect(wrapper.findComponent({ name: "UnifiedCatalogView" }).props("items")).toEqual([
      expect.objectContaining({ source: "streaming", serverId: "two", originalId: mode }),
    ]);
    await wrapper.find("select").setValue("local");
    expect(wrapper.find("select").exists()).toBe(true);
    expect(wrapper.text()).not.toContain(`Other NAS ${mode}`);
    await wrapper.find("select").setValue("all");
    expect(wrapper.text()).toContain(`Other NAS ${mode}`);
  },
);
it("音乐库显示并筛选媒体源歌曲，同时保留本地曲目", async () => {
  localStore().tracks = [
    { ...song, id: "local", source: "local", title: "Local song", serverId: undefined },
  ];
  const wrapper = await setup(Library, "/library");
  expect(wrapper.find("[data-tracks]").text()).toContain("Local song");
  expect(wrapper.find("[data-tracks]").text()).toContain("Other NAS song");
  await wrapper.find("select").setValue("two");
  expect(wrapper.find("[data-tracks]").text()).toBe("Other NAS song");
  mediaStore().servers = [{ id: "one", name: "NAS 1" }];
  mediaStore().catalog = { songs: [song], albums: [], artists: [] };
  await flushPromises();
  expect(wrapper.find("select").element.value).toBe("all");
  expect(wrapper.find("[data-tracks]").text()).toContain("Local song");
  expect(wrapper.find("[data-tracks]").text()).not.toContain("Other NAS song");
});

it("音乐库封面切换按专辑聚合并记住选择，两种视图沿用相同来源筛选", async () => {
  const wrapper = await setup(Library, "/library");
  const toggle = wrapper.find('button[aria-label="Switch to album covers"]');
  await toggle.trigger("click");
  await flushPromises();
  expect(wrapper.find("[data-tracks]").exists()).toBe(false);
  const catalog = wrapper.findComponent({ name: "UnifiedCatalogView" });
  expect(catalog.props("mode")).toBe("album");
  expect(catalog.props("items")).toHaveLength(2);
  await wrapper.find("select").setValue("two");
  expect(catalog.props("items")).toEqual([
    expect.objectContaining({ originalId: "album", serverId: "two" }),
  ]);
  wrapper.unmount();
  const reopened = await setup(Library, "/library");
  expect(reopened.find("[data-catalog]").exists()).toBe(true);
  expect(reopened.find("[data-tracks]").exists()).toBe(false);
  localStorage.removeItem("splayer-library-view");
});
