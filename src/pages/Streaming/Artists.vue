<script setup lang="ts">
defineOptions({ name: "StreamingArtists" });
import type { CoverItem } from "@/types/artist";
import { useStreamingStore } from "@/stores/streaming";
const router = useRouter();
const route = useRoute();
const streaming = useStreamingStore();
const { artists, loading, isConnected, organization } = storeToRefs(streaming);
const toolbarTarget = inject<Ref<HTMLElement | null>>("streamingToolbarTarget", ref(null));
const refreshKey = inject<{ value: number }>("streamingRefreshKey", { value: 0 });
/** 请求当前媒体源同步，实际数据更新由 store 的快照事件驱动 */
const refresh = (force = false): void => {
  if (isConnected.value) void streaming.refreshLibrary(force);
};
watch(refreshKey, () => refresh(true));
watch(isConnected, (connected) => connected && refresh());
onMounted(() => {
  if (isConnected.value && !artists.value.length) refresh();
});
/**
 * 打开当前媒体源的原始歌手身份
 * @param item - 歌手卡片
 */
const openArtist = (item: CoverItem): void => {
  router.push({
    path: `/artist/streaming/${encodeURIComponent(item.id)}`,
    query: { serverId: streaming.activeServerId ?? undefined },
  });
};
</script>
<template>
  <ArtistOrganization
    :artists="artists"
    :organization="organization"
    :loading="loading"
    :server-id="streaming.activeServerId ?? undefined"
    :toolbar-target="route.path === '/streaming/artists' ? toolbarTarget : null"
    @open-artist="openArtist"
    @updated="streaming.refreshCatalog()"
  />
</template>
