import { useLibraryStore } from "@/stores/library";
import { useStreamingStore } from "@/stores/streaming";
import type { SSelectOption } from "@/components/ui/SSelect.vue";

/** 组合本地与全部媒体源目录，为统一页面提供来源筛选 */
export const useUnifiedLibrary = () => {
  const { t } = useI18n();
  const library = useLibraryStore();
  const streaming = useStreamingStore();
  const sourceFilter = ref("all");
  const sourceOptions = computed<SSelectOption[]>(() => [
    { value: "all", label: t("library.sources.all") },
    { value: "local", label: t("library.sources.local") },
    ...streaming.servers.map((server) => ({ value: server.id, label: server.name })),
  ]);
  const tracks = computed(() => [
    ...(sourceFilter.value === "all" || sourceFilter.value === "local" ? library.tracks : []),
    ...streaming.catalog.songs.filter(
      (track) => sourceFilter.value === "all" || track.serverId === sourceFilter.value,
    ),
  ]);
  watch(sourceOptions, (options) => {
    if (!options.some((option) => option.value === sourceFilter.value)) sourceFilter.value = "all";
  });
  let ready = false;
  onMounted(async () => {
    await Promise.all([library.initialized ? Promise.resolve() : library.load(), streaming.init()]);
    ready = true;
  });
  onActivated(() => {
    if (ready) void streaming.refreshCatalog();
  });
  return { library, streaming, sourceFilter, sourceOptions, tracks };
};
