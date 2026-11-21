<script setup lang="ts">
import type { AlbumArtwork, AlbumArtworkStatus } from "@shared/types/streaming";
import { toast } from "@/composables/useToast";

const props = defineProps<{
  serverId: string;
  albumId: string;
  src?: string;
  original?: string;
  fallback?: string;
  alt: string;
}>();
const { t } = useI18n();
const open = ref(false);
const artworks = shallowRef<AlbumArtwork[]>([]);
const availability = shallowRef<AlbumArtworkStatus>({ found: 0, unavailable: [] });
const index = ref(0);
const saving = ref(false);
const committedCover = ref<string>();
const emit = defineEmits<{ saved: [thumbnail: string] }>();
const loading = ref(false);
let revision = 0;
const pictures = computed<AlbumArtwork[]>(() =>
  artworks.value.length
    ? artworks.value
    : props.src
      ? [
          {
            id: "server",
            name: t("artwork.serverCover"),
            thumbnail: props.src,
            original: props.src.startsWith("streaming-cover://image")
              ? props.src.replace(/([?&]size=)\d+/, (_match, prefix: string) => `${prefix}1500`)
              : props.src,
          },
        ]
      : [],
);
const current = computed(() => pictures.value[index.value] ?? pictures.value[0]);
const canRestore = computed(
  () =>
    artworks.value.some((picture) => picture.selected) ||
    props.src?.startsWith("streaming-cover://album-artwork"),
);

/** 主动恢复服务器默认封面，离线时也可清除本地选择 */
const restore = async (): Promise<void> => {
  if (saving.value) return;
  const request = ++revision;
  loading.value = false;
  saving.value = true;
  try {
    await window.api.streaming.setAlbumArtwork(props.serverId, props.albumId, "");
    const snapshot = await window.api.streaming.getSnapshot(props.serverId);
    if (request !== revision) return;
    const cover = snapshot.albums.find((album) => album.id === props.albumId)?.cover ?? "";
    committedCover.value = cover;
    artworks.value = artworks.value.map((picture) => ({ ...picture, selected: false }));
    emit("saved", cover);
    open.value = false;
  } catch (error) {
    toast.error(String(error));
  } finally {
    saving.value = false;
  }
};

/** 只为当前专辑读取图片清单，迟到的结果不得替换新的专辑 */
const reload = async (): Promise<void> => {
  const request = ++revision;
  loading.value = true;
  artworks.value = [];
  availability.value = { found: 0, unavailable: [] };
  index.value = 0;
  try {
    const result = await window.api.streaming.getAlbumArtworks(props.serverId, props.albumId);
    const status = await window.api.streaming.getAlbumArtworkStatus(props.serverId, props.albumId);
    if (request === revision) {
      artworks.value = result;
      availability.value = status;
      const chosen = result.findIndex((picture) => picture.selected);
      index.value = Math.max(0, chosen);
      committedCover.value = chosen >= 0 ? result[chosen].thumbnail : undefined;
    }
  } catch (error) {
    if (request === revision) toast.error(String(error));
  } finally {
    if (request === revision) loading.value = false;
  }
};

/** 确认当前主封面并通知列表同步，浏览其他图片不会提前保存 */
const confirm = async (): Promise<void> => {
  if (
    saving.value ||
    loading.value ||
    availability.value.error ||
    !artworks.value.length ||
    !current.value
  )
    return;
  const request = revision;
  const picture = current.value;
  saving.value = true;
  try {
    const result = await window.api.streaming.setAlbumArtwork(
      props.serverId,
      props.albumId,
      picture.id,
    );
    if (request !== revision) return;
    artworks.value = result;
    const confirmed = result.find((image) => image.selected)?.thumbnail ?? picture.thumbnail;
    committedCover.value = confirmed;
    emit("saved", confirmed);
    open.value = false;
  } catch (error) {
    toast.error(String(error));
  } finally {
    saving.value = false;
  }
};

/** 循环切换封面，仅在大图弹窗加载当前原图 */
const step = (offset: number): void => {
  if (pictures.value.length)
    index.value = (index.value + offset + pictures.value.length) % pictures.value.length;
};
watch(
  () => [props.serverId, props.albumId],
  () => {
    committedCover.value = undefined;
    void reload();
  },
  { immediate: true },
);
watch(open, (value) => {
  if (value) {
    if (availability.value.error && !loading.value) void reload();
    const selected = pictures.value.findIndex((picture) => picture.selected);
    index.value = Math.max(0, selected);
  }
});
onBeforeUnmount(() => {
  revision++;
});
</script>

<template>
  <div class="relative">
    <button
      class="size-full rounded-xl overflow-hidden bg-transparent border-0 appearance-none p-0"
      :aria-label="t('artwork.open')"
      @click="open = true"
    >
      <DetailCover :src="committedCover ?? src" :fallback="fallback" :alt="alt" class="size-full" />
    </button>
    <button
      v-if="pictures.length > 1"
      class="absolute right-1.5 bottom-1.5 px-2 py-1 text-xs rounded-md bg-black/65 text-white flex items-center gap-1"
      :aria-label="t('artwork.open')"
      @click="open = true"
    >
      <IconLucideImages class="size-3.5" />
      {{ index + 1 }}/{{ pictures.length }}
    </button>
    <SDialog
      v-model:open="open"
      :title="alt"
      width="min(1080px, calc(100vw - 32px))"
      destroy-on-close
    >
      <div
        class="flex flex-col gap-4"
        @keydown.left.prevent="step(-1)"
        @keydown.right.prevent="step(1)"
      >
        <div class="artwork-layout">
          <div class="min-w-0 flex flex-col gap-3">
            <div
              class="artwork-preview relative flex items-center justify-center bg-surface-alt rounded-xl overflow-hidden"
            >
              <img
                v-if="current"
                :key="current.id"
                :src="current.original"
                :alt="current.name"
                decoding="async"
                class="max-w-full max-h-full object-contain"
              />
              <SLoading v-if="loading" class="absolute size-6" />
              <template v-if="pictures.length > 1">
                <SButton
                  circle
                  class="absolute left-3"
                  :title="t('artwork.previous')"
                  :aria-label="t('artwork.previous')"
                  @click="step(-1)"
                >
                  <template #icon><IconLucideChevronLeft /></template>
                </SButton>
                <SButton
                  circle
                  class="absolute right-3"
                  :title="t('artwork.next')"
                  :aria-label="t('artwork.next')"
                  @click="step(1)"
                >
                  <template #icon><IconLucideChevronRight /></template>
                </SButton>
              </template>
            </div>
            <p v-if="current" class="text-sm text-on-surface-variant text-center truncate">
              <template v-if="artworks.length">{{ index + 1 }} / {{ pictures.length }} ·</template>
              {{ current.name }}
            </p>
          </div>
          <aside class="artwork-choices min-w-0" :aria-label="t('artwork.chooseCover')">
            <div class="pb-3">
              <h3 class="text-sm font-semibold">{{ t("artwork.chooseCover") }}</h3>
              <p class="text-xs text-on-surface-variant mt-1">
                {{
                  loading
                    ? t("common.loading")
                    : t("artwork.foundCount", { count: availability.found })
                }}
              </p>
            </div>
            <div class="artwork-choice-list flex flex-col gap-2 overflow-y-auto">
              <button
                v-for="(picture, pictureIndex) in pictures"
                :key="picture.id"
                :aria-label="picture.name"
                :aria-pressed="pictureIndex === index"
                class="artwork-choice flex items-center gap-3 p-2 rounded-lg text-left"
                :class="pictureIndex === index ? 'bg-primary/10' : ''"
                @click="index = pictureIndex"
              >
                <SImg
                  :src="picture.thumbnail"
                  :alt="picture.name"
                  class="size-16 rounded-md shrink-0"
                />
                <span class="min-w-0 flex-1">
                  <span class="block text-sm break-words">{{ picture.name }}</span>
                  <span v-if="picture.selected" class="block text-xs text-primary mt-1">
                    {{ t("artwork.currentCover") }}
                  </span>
                </span>
                <span
                  class="size-4 rounded-full border shrink-0 flex items-center justify-center"
                  :class="
                    pictureIndex === index
                      ? 'border-primary text-primary'
                      : 'border-outline-variant text-on-surface-variant'
                  "
                  aria-hidden="true"
                >
                  <span v-if="pictureIndex === index" class="size-2 rounded-full bg-current" />
                </span>
              </button>
              <div
                v-for="filename in availability.unavailable"
                :key="filename"
                class="flex items-center gap-3 p-2 opacity-60"
                :title="t('artwork.unreadable')"
              >
                <span
                  class="size-16 rounded-md bg-surface-alt shrink-0 flex items-center justify-center"
                >
                  <IconLucideImageOff class="size-6 text-on-surface-variant" />
                </span>
                <span class="min-w-0">
                  <span class="block text-sm break-words">{{ filename }}</span>
                  <span class="block text-xs text-on-surface-variant mt-1">
                    {{ t("artwork.unreadable") }}
                  </span>
                </span>
              </div>
            </div>
            <p
              v-if="!loading && availability.unavailable.length"
              role="status"
              class="text-xs text-on-surface-variant mt-3 leading-relaxed"
            >
              {{ t("artwork.unreadableHint") }}
            </p>
            <p
              v-else-if="!loading && availability.error"
              role="status"
              class="text-xs text-on-surface-variant mt-3"
            >
              {{
                t(
                  availability.error === "extension-unavailable"
                    ? "artwork.extensionUnavailable"
                    : availability.error === "auth-failed"
                      ? "artwork.authFailed"
                      : "artwork.requestFailed",
                )
              }}
            </p>
          </aside>
        </div>
        <div class="flex flex-wrap items-center justify-between gap-3">
          <p class="text-xs text-on-surface-variant flex-1 min-w-48">
            {{ t("artwork.selectionHint") }}
          </p>
          <SButton v-if="canRestore" :disabled="saving" @click="restore">
            {{ t("artwork.restoreDefault") }}
          </SButton>
          <SButton
            :disabled="saving || loading || !!availability.error || !artworks.length || !current"
            type="primary"
            @click="confirm"
          >
            {{ t("common.confirm") }}
          </SButton>
        </div>
      </div>
    </SDialog>
  </div>
</template>

<style scoped>
.artwork-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 270px;
  gap: 24px;
}
.artwork-preview {
  height: min(57vh, 590px);
}
.artwork-choice-list {
  max-height: min(46vh, 470px);
}
.artwork-choice {
  background-color: transparent;
  border: 1px solid transparent;
  appearance: none;
  color: inherit;
  font: inherit;
}
.artwork-choice[aria-pressed="true"] {
  background-color: rgb(var(--s-primary) / 0.1);
  border-color: rgb(var(--s-primary));
}
.artwork-choice:hover {
  border-color: rgb(var(--s-primary));
}
.artwork-choice:focus-visible {
  outline: 2px solid rgb(var(--s-primary));
  outline-offset: 2px;
}
@media (max-width: 700px) {
  .artwork-layout {
    grid-template-columns: minmax(0, 1fr);
    gap: 16px;
  }
  .artwork-preview {
    height: min(40vh, 380px);
  }
  .artwork-choice-list {
    max-height: 180px;
  }
}
</style>
