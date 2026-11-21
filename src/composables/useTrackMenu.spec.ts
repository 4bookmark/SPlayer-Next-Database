import { mount } from "@vue/test-utils";
import { defineComponent, ref } from "vue";
import { createI18n } from "vue-i18n";
import { expect, it, vi } from "vitest";
import type { Track } from "@shared/types/player";
import english from "@/i18n/locales/en-US.json";
import { useTrackMenu } from "./useTrackMenu";
vi.mock("@/core/player", () => ({ playNow: vi.fn(), insertToQueue: vi.fn() }));
vi.mock("vue-router", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/stores/settings", () => ({
  useSettingsStore: () => ({ system: { download: { enabled: false } } }),
}));
vi.mock("@/stores/plugins", () => ({ usePluginsStore: () => ({ menuContributions: [] }) }));
vi.mock("@/stores/status", () => ({ useStatusStore: () => ({}) }));
vi.mock("@/stores/download", () => ({ useDownloadStore: () => ({ isDownloaded: () => false }) }));
vi.mock("@/composables/useCopyText", () => ({ useCopyText: () => ({ copy: vi.fn() }) }));
vi.mock("@/composables/useDownload", () => ({ buildDownloadQualityItems: () => [] }));
vi.mock("@/utils/format/shareUrl", () => ({ getTrackShareUrl: () => "" }));
it("媒体源右键提供加入本地歌单操作并传递原始歌曲身份", async () => {
  const track: Track = {
    id: "server:song",
    source: "streaming",
    serverId: "server",
    originalId: "song",
    title: "Song",
    artists: [],
    duration: 1,
  };
  const add = vi.fn();
  let menu!: ReturnType<typeof useTrackMenu>;
  const wrapper = mount(
    defineComponent({
      setup() {
        menu = useTrackMenu(ref(track), { onAddToPlaylist: add });
        return () => null;
      },
    }),
    {
      global: { plugins: [createI18n({ legacy: false, locale: "en", messages: { en: english } })] },
    },
  );
  expect(menu.items.value.find((item) => item.key === "addToPlaylist")?.show).toBe(true);
  expect(menu.items.value.find((item) => item.key === "editTags")?.show).toBe(false);
  await menu.handleSelect("addToPlaylist");
  expect(add).toHaveBeenCalledWith(track);
  wrapper.unmount();
});
