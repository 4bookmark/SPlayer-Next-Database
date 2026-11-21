import type { Ref } from "vue";
import type { Collection } from "@/types/collection";
import { useUserStore } from "@/stores/user";
import { toast } from "@/composables/useToast";
import { useStreamingStore } from "@/stores/streaming";

/**
 * 通用收藏 / 取消收藏
 *
 * 网易歌单与专辑收藏走服务端，所有媒体源专辑使用本地持久收藏
 */
export const useCollectionSubscribe = (collection: Ref<Collection | null>) => {
  const { t } = useI18n();
  const userStore = useUserStore();
  const streaming = useStreamingStore();
  const busy = ref(false);

  /** 当前是否已收藏 */
  const isSubscribed = computed(() => {
    const current = collection.value;
    if (!current) return false;
    if (current.source === "streaming" && current.type === "album")
      return streaming.savedFavorites.albums.some(
        (item) => item.id === current.id && item.serverId === current.serverId,
      );
    if (current.source !== "netease") return false;
    if (current.type === "playlist") {
      return userStore.subscribedPlaylists.some((item) => item.id === current.id);
    }
    if (current.type === "album") {
      return userStore.albums.some((item) => item.id === current.id);
    }
    return false;
  });

  /** 网易非自建合集及媒体源专辑显示收藏入口 */
  const available = computed(() => {
    const current = collection.value;
    if (!current) return false;
    if (current.source === "streaming") return current.type === "album" && !!current.serverId;
    if (current.source !== "netease") return false;
    if (current.type === "playlist") {
      return !userStore.createdPlaylists.some((item) => item.id === current.id);
    }
    if (current.type === "album") return true;
    return false;
  });

  /** 切换收藏状态 */
  const toggle = async (): Promise<void> => {
    const current = collection.value;
    if (!current || busy.value || !available.value) return;
    busy.value = true;
    try {
      const next = !isSubscribed.value;
      if (current.source === "streaming" && current.serverId) {
        await streaming.setCollectionFavorite("album", current.serverId, current.id, next);
        return;
      }
      if (current.type === "playlist") {
        await userStore.togglePlaylistSubscribe(current.id, next);
      } else if (current.type === "album") {
        await userStore.toggleAlbumSubscribe(current.id, next);
      }
    } catch (err) {
      const message = err instanceof Error && err.message ? err.message : t("liked.toast.failed");
      toast.error(message);
    } finally {
      busy.value = false;
    }
  };

  return { available, isSubscribed, busy, toggle };
};
