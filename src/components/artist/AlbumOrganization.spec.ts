import { mount, flushPromises } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { beforeEach, describe, expect, it, vi } from "vitest";
import english from "@/i18n/locales/en-US.json";
import AlbumOrganization from "./AlbumOrganization.vue";
vi.mock("@/composables/useToast", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
const items = [
  { id: "old", title: "Old", year: 2010, trackCount: 10 },
  { id: "new", title: "New", year: 2024, trackCount: 2 },
  { id: "none", title: "Unknown", trackCount: 1 },
];
const i18n = createI18n({
  legacy: false,
  locale: "en",
  messages: { en: english },
});
beforeEach(() => {
  Object.assign(window, {
    api: {
      streaming: {
        getSnapshot: vi.fn(async () => ({
          organization: { artistGroups: [], categories: [], albumCategories: {} },
        })),
      },
    },
  });
});
describe("歌手发行时间线", () => {
  it("默认新到旧，缺失年份置末尾，可切换旧到新并打开原始专辑", async () => {
    const wrapper = mount(AlbumOrganization, {
      props: { items, timeline: true },
      global: {
        plugins: [i18n],
        stubs: {
          SButton: { template: "<button><slot /></button>" },
          SImg: true,
          SDialog: true,
          GroupedCoverList: {
            emits: ["click"],
            props: ["groups"],
            template:
              "<div><section v-for='group in groups' :key='group.id'><h2>{{group.title}}</h2><button v-for='item in group.items' :key='item.id' @click='$emit(\"click\", item)'>{{item.title}} {{item.subtitle}}</button></section></div>",
          },
        },
      },
    });
    await flushPromises();
    expect(wrapper.findAll("h2").map((h) => h.text())).toEqual(["2024", "2010", "Year unknown"]);
    await wrapper.find("button").trigger("click");
    expect(wrapper.findAll("h2").map((h) => h.text())).toEqual(["2010", "2024", "Year unknown"]);
    await wrapper.find("section button").trigger("click");
    expect(wrapper.emitted("openAlbum")?.[0]?.[0]).toMatchObject({ id: "old" });
  });
  it("直接按类别分段，文件夹优先于数量，手动分类优先于自动判断", async () => {
    vi.mocked(window.api.streaming.getSnapshot).mockResolvedValue({
      organization: {
        artistGroups: [],
        categories: [{ id: "custom", name: "Acoustic" }],
        albumCategories: { manual: "custom", none: "uncategorized" },
      },
      albums: [],
      songs: [],
      artists: [],
      playlists: [],
    });
    const wrapper = mount(AlbumOrganization, {
      props: {
        serverId: "server",
        items: [
          { id: "record", title: "Studio", year: 2024, trackCount: 12 },
          { id: "ep", title: "Short release", year: 2022, trackCount: 3 },
          { id: "concert", title: "Concert", year: 2020, trackCount: 2 },
          { id: "manual", title: "A Live Album", trackCount: 12 },
          { id: "none", title: "Unsorted", trackCount: 10 },
        ],
        tracks: [
          {
            id: "song",
            source: "streaming",
            title: "Song",
            artists: [],
            duration: 1000,
            album: { id: "concert", name: "Concert" },
            libraryPath: "Artist/Live/Concert/01.flac",
          },
        ],
      },
      global: {
        plugins: [i18n],
        stubs: {
          SButton: { template: "<button><slot /></button>" },
          SSelect: true,
          SDialog: true,
          GroupedCoverList: {
            emits: ["click"],
            props: ["groups"],
            template:
              "<div><section v-for='group in groups' :key='group.id' :data-category='group.id'><h2>{{group.title}}</h2><button v-for='item in group.items' :key='item.id' @click='$emit(\"click\", item)'>{{item.title}} {{item.subtitle}}</button></section></div>",
          },
        },
      },
    });
    await flushPromises();
    expect(wrapper.find('[data-category="album"]').text()).toContain("Studio 2024");
    expect(wrapper.find('[data-category="single-ep"]').text()).toContain("Short release 2022");
    expect(wrapper.find('[data-category="live"]').text()).toContain("Concert 2020");
    expect(wrapper.find('[data-category="custom"]').text()).toContain("A Live Album");
    expect(wrapper.find('[data-category="uncategorized"]').text()).toContain("Unsorted");
    await wrapper.find('[data-category="live"] button').trigger("click");
    expect(wrapper.emitted("openAlbum")?.[0]?.[0]).toMatchObject({ id: "concert" });
  });
});
