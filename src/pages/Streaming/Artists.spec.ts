import { mount, flushPromises } from "@vue/test-utils";
import { createPinia, defineStore, setActivePinia } from "pinia";
import { createMemoryHistory, createRouter } from "vue-router";
import { createI18n } from "vue-i18n";
import { shallowRef, ref } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StreamingOrganization } from "@shared/types/streaming";
import english from "@/i18n/locales/en-US.json";
import Artists from "./Artists.vue";
import ArtistOrganization from "@/components/artist/ArtistOrganization.vue";

const mock = vi.hoisted(() => ({ store: undefined as unknown, organize: vi.fn(async () => {}) }));
vi.mock("@/stores/streaming", () => ({ useStreamingStore: () => mock.store }));
vi.mock("@/composables/useToast", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
const useFixture = defineStore("artist-categories-test", () => ({
  activeServerId: ref("server"),
  artists: shallowRef([
    { id: "a", name: "Artist A", albumCount: 3 },
    { id: "b", name: "Artist B", albumCount: 2 },
  ]),
  loading: ref(false),
  isConnected: ref(true),
  organization: shallowRef<StreamingOrganization>({
    artistGroups: [],
    categories: [],
    albumCategories: {},
    artistCategoryDefinitions: [{ id: "western", name: "Western" }],
    artistCategories: { a: "western" },
  }),
  organize: mock.organize,
  refreshLibrary: vi.fn(),
  refreshCatalog: vi.fn(),
}));
beforeEach(() => {
  vi.clearAllMocks();
  setActivePinia(createPinia());
  mock.store = useFixture();
  Object.assign(window, { api: { streaming: { organize: mock.organize } } });
});

describe("歌手自定义分类", () => {
  it("按自定义地区和未分类分组，可筛选并将所选原始歌手归类", async () => {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: "/streaming/artists", component: { template: "<div />" } }],
    });
    await router.push("/streaming/artists");
    const wrapper = mount(Artists, {
      global: {
        plugins: [router, createI18n({ legacy: false, locale: "en", messages: { en: english } })],
        provide: { streamingRefreshKey: ref(0) },
        components: { ArtistOrganization },
        stubs: {
          IconLucideSettings2: true,
          IconLucideUserRound: true,
          ArtistMergeDialog: true,
          CategoryManagerDialog: true,
          SButton: { template: "<button><slot /><slot name='icon' /></button>" },
          SSelect: {
            props: ["modelValue", "options"],
            template:
              "<select :value='modelValue' @change='$emit(\"update:modelValue\", $event.target.value)'><option v-for='option in options' :key='option.value' :value='option.value'>{{option.label}}</option></select>",
          },
          GroupedCoverList: {
            emits: ["click"],
            props: ["groups"],
            template:
              "<div><section v-for='group in groups' :key='group.id' :data-category='group.id'><h2>{{group.title}}</h2><button v-for='item in group.items' :key='item.id' @click='$emit(\"click\", item)'>{{item.title}}</button></section></div>",
          },
        },
      },
    });
    await flushPromises();
    expect(wrapper.find('[data-category="western"]').text()).toContain("Artist A");
    expect(wrapper.find('[data-category="uncategorized"]').text()).toContain("Artist B");
    await wrapper.find("select").setValue("uncategorized");
    expect(wrapper.find('[data-category="western"]').exists()).toBe(false);
    await wrapper
      .findAll("button")
      .find((button) => button.text() === english.organization.select)!
      .trigger("click");
    await wrapper.find('[data-category="uncategorized"] button').trigger("click");
    await wrapper.findAll("select")[1].setValue("western");
    await wrapper
      .findAll("button")
      .find((button) => button.text() === english.organization.assign)!
      .trigger("click");
    await flushPromises();
    expect(mock.organize).toHaveBeenCalledWith("server", {
      type: "artist-classify",
      artistIds: ["b"],
      categoryId: "western",
    });
    expect(router.currentRoute.value.path).toBe("/streaming/artists");
  });
});
