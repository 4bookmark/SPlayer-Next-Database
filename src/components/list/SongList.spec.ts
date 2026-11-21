import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mount, flushPromises, type VueWrapper } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { defineComponent, h, nextTick, ref, toRaw } from "vue";
import english from "@/i18n/locales/en-US.json";
import type { Track } from "@shared/types/player";
import SVirtualList from "@/components/ui/SVirtualList.vue";
import SongList from "./SongList.vue";
import SDropdownMenu from "@/components/ui/SDropdownMenu.vue";
import {
  DropdownMenuRoot,
  DropdownMenuTrigger,
  DropdownMenuPortal,
  DropdownMenuContent,
  DropdownMenuItem,
} from "reka-ui";

const mocks = vi.hoisted(() => ({
  playNow: vi.fn(),
  playFrom: vi.fn(),
  togglePlay: vi.fn(),
  favorite: vi.fn(),
  menu: vi.fn(),
  settings: {
    appearance: { songListStyle: "card" },
    player: { songListPlayBehavior: "single", searchPlayBehavior: "all" },
    preset: { showSubtitle: true },
    system: { download: { enabled: false } },
  },
}));
vi.mock("@/core/player", () => ({
  playNow: mocks.playNow,
  playFrom: mocks.playFrom,
  togglePlay: mocks.togglePlay,
}));
vi.mock("@/stores/media", () => ({ useMediaStore: () => ({ track: null }) }));
vi.mock("@/stores/status", () => ({ useStatusStore: () => ({ isPlaying: false }) }));
vi.mock("@/stores/settings", () => ({ useSettingsStore: () => mocks.settings }));
vi.mock("@/stores/download", () => ({ useDownloadStore: () => ({ isDownloaded: () => false }) }));
vi.mock("@/composables/useFavorite", () => ({
  useFavorite: () => ({ isSupported: () => true, isLiked: () => false, toggle: mocks.favorite }),
}));
vi.mock("@/composables/useTrackMenu", () => ({
  useTrackMenu: () => ({
    items: ref([{ key: "play-next", label: "Play next" }]),
    handleSelect: mocks.menu,
  }),
}));
vi.mock("@/composables/useDownload", () => ({ useDownload: () => ({ enqueue: vi.fn() }) }));
vi.mock("@/composables/usePlaylistPicker", () => ({
  usePlaylistPicker: () => ({
    open: ref(false),
    tracks: ref([]),
    mode: ref("add"),
    openPicker: vi.fn(),
  }),
}));
vi.mock("@/composables/useFloatingPlayerBar", () => ({
  useFloatingPlayerBar: () => ({ isFloatingBar: ref(false), PLAYER_BAR_GAP: 112 }),
}));
vi.mock("@/utils/navigate", () => ({ navigateToAlbum: vi.fn(), navigateToArtist: vi.fn() }));
vi.mock("vue-router", () => ({ useRoute: () => ({ name: "collection" }) }));
vi.mock("@/composables/useMultiSelect", () => ({
  useMultiSelect: () => {
    const active = ref(false);
    const selectedIds = ref(new Set<string>());
    return {
      active,
      selectedIds,
      deleteConfirmOpen: ref(false),
      deleteDialogTitle: ref(""),
      deleteDialogContent: ref(""),
      enter: () => {
        active.value = true;
      },
      exit: () => {
        active.value = false;
      },
      toggle: (id: string) => {
        selectedIds.value.add(id);
      },
      selectedCount: ref(0),
      isAllSelected: ref(false),
      isPartial: ref(false),
      canRemove: ref(false),
      canRemoveFromCloud: ref(false),
    };
  },
}));
vi.mock("@vueuse/core", async (original) => ({
  ...(await original<typeof import("@vueuse/core")>()),
  useElementSize: () => ({ width: ref(1000), height: ref(400) }),
}));

const Passthrough = defineComponent({
  setup:
    (_, { slots }) =>
    () =>
      h("div", slots.default?.()),
});
const Button = defineComponent({
  setup:
    (_, { slots, attrs }) =>
    () =>
      h("button", attrs, [slots.default?.(), slots.icon?.()]),
});
const Dropdown = defineComponent({
  emits: ["select"],
  setup:
    (_, { slots, emit }) =>
    () =>
      h(
        "div",
        { "data-more-menu": "", onClick: () => emit("select", "play-next") },
        slots.trigger?.(),
      ),
});
const i18n = createI18n({ legacy: false, locale: "en", messages: { en: english } });
let view: VueWrapper | undefined;

/** 生成真实曲目标识和双碟布局
 * @param count - 曲目数
 * @returns 曲目列表
 */
function tracks(count: number): Track[] {
  return Array.from(
    { length: count },
    (_, index) =>
      ({
        id: `server/original-${index}`,
        source: "streaming",
        title: `Track ${index}`,
        artists: [{ id: "artist", name: "Artist Name" }],
        album: { id: "album", name: "Album Name" },
        duration: 120000,
        cover: "cover://album",
        disc: index < count / 2 ? 1 : 2,
        discTitle: index < count / 2 ? "First disc" : "Second disc",
        comment: "Subtitle",
      }) as Track,
  );
}

/** 渲染真实虚拟列表，隔离弹窗与数据服务
 * @param items - 曲目
 * @param compact - 是否单行视图
 */
async function render(items: Track[], compact = true, realMenu = false): Promise<VueWrapper> {
  view = mount(SongList, {
    attachTo: document.body,
    props: { items, compact, collectionType: "album" },
    global: {
      plugins: [i18n],
      components: {
        SVirtualList,
        SDropdownMenu,
        DropdownMenuRoot,
        DropdownMenuTrigger,
        DropdownMenuPortal,
        DropdownMenuContent,
        DropdownMenuItem,
      },
      stubs: {
        SContextMenu: Passthrough,
        SButton: Button,
        SDropdownMenu: realMenu ? false : Dropdown,
        SImg: { template: "<img data-track-cover />" },
        SIconSwap: { template: '<span><slot name="off" /></span>' },
        SDialog: true,
        PlaylistPickerDialog: true,
        TagEditorDialog: true,
        STag: true,
        SCheckbox: true,
      },
    },
  });
  await nextTick();
  await nextTick();
  return view;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.settings.appearance.songListStyle = "card";
});
afterEach(() => {
  view?.unmount();
  view = undefined;
});

describe("SongList compact album view", () => {
  it("virtualizes thousands of single-line tracks while retaining discs, playback, favorite and more", async () => {
    const items = tracks(2000);
    const wrapper = await render(items);
    const rows = wrapper.findAll("[data-song-item]");
    expect(rows.length).toBeGreaterThan(1);
    expect(rows.length).toBeLessThan(30);
    expect(rows[0].classes()).toContain("h-12");
    const dimensions = wrapper.findComponent(SVirtualList).props() as {
      itemHeight: number;
      exactItemHeights: number[];
    };
    expect(dimensions.itemHeight).toBe(48);
    expect(dimensions.exactItemHeights[0]).toBe(88);
    expect(dimensions.exactItemHeights[1000]).toBe(88);
    expect(dimensions.exactItemHeights[1]).toBe(48);
    expect(rows[0].classes()).not.toContain("rounded-xl");
    expect(rows[0].find("[data-track-cover]").exists()).toBe(false);
    expect(rows[0].text()).toContain("Track 0");
    expect(rows[0].text()).not.toContain("Artist Name");
    expect(rows[0].text()).not.toContain("Subtitle");
    expect(wrapper.text()).toContain("First disc");
    expect(rows[0].text()).toContain("02:00");
    await rows[0].find("button").trigger("click");
    expect(toRaw(mocks.playNow.mock.calls[0][0])).toBe(items[0]);
    const buttons = rows[0].findAll("button");
    await buttons[1].trigger("click");
    expect(toRaw(mocks.favorite.mock.calls[0][0])).toBe(items[0]);
    await buttons[2].trigger("click");
    expect(mocks.menu).toHaveBeenCalledWith("play-next");
    expect(mocks.playNow).toHaveBeenCalledTimes(1);
    await rows[1].trigger("dblclick");
    expect(mocks.playFrom.mock.calls[0][1]).toMatchObject({ startIndex: 1 });
    expect(toRaw(mocks.playFrom.mock.calls[0][0][1])).toBe(items[1]);
  });

  it("retains original card view and global compact style when album compact is disabled", async () => {
    const wrapper = await render(tracks(4), false);
    expect(wrapper.find("[data-song-item]").classes()).toContain("h-19");
    expect(wrapper.find("[data-track-cover]").exists()).toBe(true);
    expect(wrapper.find("[data-song-item]").text()).toContain("Artist Name");
    await wrapper.setProps({ compact: true });
    expect(wrapper.find("[data-song-item]").classes()).toContain("h-12");
    await wrapper.setProps({ compact: false });
    expect(wrapper.find("[data-track-cover]").exists()).toBe(true);
    wrapper.unmount();
    mocks.settings.appearance.songListStyle = "compact";
    const globalCompact = await render(tracks(4), false);
    expect(globalCompact.find("[data-song-item]").classes()).toContain("h-14");
    expect(globalCompact.find("[data-track-cover]").exists()).toBe(true);
  });

  it("keeps batch selection functional without triggering playback in compact mode", async () => {
    const wrapper = await render(tracks(4));
    (wrapper.vm as unknown as { enterBatch: () => void }).enterBatch();
    await nextTick();
    await wrapper.find("[data-song-item]").trigger("click");
    expect(wrapper.find("[data-song-item]").classes()).toContain("bg-primary/10");
    expect(mocks.playNow).not.toHaveBeenCalled();
    expect(wrapper.find("[data-more-menu]").exists()).toBe(false);
  });
});

it("opens the real compact more menu by mouse and keyboard without starting playback", async () => {
  const wrapper = await render(tracks(4), true, true);
  const row = wrapper.find("[data-song-item]");
  const more = row.find('button[aria-label="Actions"]');
  expect(more.exists()).toBe(true);
  await more.trigger("click");
  await flushPromises();
  expect(document.body.querySelector('[role="menu"]')).not.toBeNull();
  const item = document.body.querySelector('[role="menuitem"]') as HTMLElement;
  expect(item.textContent).toContain("Play next");
  item.click();
  await flushPromises();
  expect(mocks.menu).toHaveBeenCalledWith("play-next");
  expect(mocks.playNow).not.toHaveBeenCalled();
  await more.trigger("keydown", { key: "Enter" });
  await flushPromises();
  expect(document.body.querySelector('[role="menu"]')).not.toBeNull();
});
