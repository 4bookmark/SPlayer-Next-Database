<script setup lang="ts">
defineOptions({ name: "Library" });

import type { CoverItem } from "@/types/artist";
import { unifiedCoverItems } from "@/utils/unifiedLibrary";
import type { PlaybackContext } from "@shared/types/player";
import type { DropdownMenuItem } from "@/components/ui/SDropdownMenu.vue";
import { useUnifiedLibrary } from "@/composables/useUnifiedLibrary";
import SongList from "@/components/list/SongList.vue";
import { formatFileSize } from "@/utils/format";
import IconFolderOpen from "~icons/lucide/folder-open";
import IconRefreshCw from "~icons/lucide/refresh-cw";
import IconLucideListChecks from "~icons/lucide/list-checks";
import * as player from "@/core/player";

const { t } = useI18n();
const {
  library: libraryStore,
  streaming,
  tracks,
  sourceFilter,
  sourceOptions,
} = useUnifiedLibrary();
const { scanDirs, scanning, scanProgress } = storeToRefs(libraryStore);

const playbackContext = computed<PlaybackContext>(() => ({
  originId: "library",
  originType: "page",
  originName: t("library.title"),
}));

/** 搜索关键词 */
const searchQuery = ref("");

/** 音乐库沿用媒体源的专辑整理组件，列表选择独立持久保存 */
const libraryView = useLocalStorage<"songs" | "albums">("splayer-library-view", "songs");
const organizationToolbar = shallowRef<HTMLElement | null>(null);
const visibleTracks = computed(() => {
  const needle = searchQuery.value.trim().toLocaleLowerCase();
  return needle
    ? tracks.value.filter((track) =>
        [track.title, track.album?.name, ...track.artists.map((artist) => artist.name)].some(
          (value) => value?.toLocaleLowerCase().includes(needle),
        ),
      )
    : tracks.value;
});
const albumItems = computed<CoverItem[]>(() => {
  const names = Object.fromEntries(streaming.servers.map((server) => [server.id, server.name]));
  names.local = t("library.sources.local");
  const keys = new Set(
    visibleTracks.value
      .filter((track) => track.album)
      .map((track) =>
        track.source === "local"
          ? `local:${encodeURIComponent(track.album!.name.trim())}`
          : `streaming:${track.serverId}:${track.album!.id}`,
      ),
  );
  return unifiedCoverItems(
    "album",
    libraryStore.tracks,
    streaming.catalog,
    names,
    libraryStore.artistAvatars,
  ).filter((item) => keys.has(item.id));
});

/** 多选模式 */
const songListRef = shallowRef<InstanceType<typeof SongList> | null>(null);

/** 所有歌曲的总文件大小 */
const totalSize = computed(() => {
  const bytes = tracks.value.reduce((sum, track) => sum + (track.fileSize ?? 0), 0);
  return bytes > 0 ? formatFileSize(bytes) : "";
});

/** 新增目录后立即扫描 */
const handleFolderAdded = (): void => {
  libraryStore.startScan(false);
};

const handleQuickAddFolder = async (): Promise<void> => {
  const res = await libraryStore.addScanDir();
  if (res.success) libraryStore.startScan(false);
};

// 播放全部
const handlePlayAll = (): void => {
  if (visibleTracks.value.length === 0) return;
  player.playFrom(visibleTracks.value, { context: playbackContext.value });
};

// 扫描进度百分比
const scanPercent = computed(() => {
  if (!scanProgress.value || scanProgress.value.total === 0) return 0;
  return Math.round((scanProgress.value.scanned / scanProgress.value.total) * 100);
});

// 目录管理弹窗
const folderDialogOpen = ref(false);

const moreMenuItems = computed<DropdownMenuItem[]>(() => [
  { key: "batchManage", label: t("songList.batch.manage"), icon: IconLucideListChecks },
  { key: "folders", label: t("library.folders"), icon: IconFolderOpen, separator: true },
  {
    key: "scan",
    label: scanning.value ? t("library.scanning") : t("library.scanAll"),
    icon: IconRefreshCw,
    disabled: scanning.value || scanDirs.value.length === 0,
  },
]);

/**
 * 执行音乐库管理操作，歌曲批量管理统一在列表视图打开
 * @param key - 菜单操作
 */
const handleMoreMenu = async (key: string): Promise<void> => {
  switch (key) {
    // 批量管理
    case "batchManage":
      libraryView.value = "songs";
      await nextTick();
      songListRef.value?.enterBatch();
      break;
    // 目录管理
    case "folders":
      folderDialogOpen.value = true;
      break;
    // 全量扫描
    case "scan":
      libraryStore.startScan(false);
      break;
  }
};

// 进入页面时初始化
onMounted(async () => {
  libraryStore.subscribeScanProgress();
  // 有目录即扫描：尚无曲目时全量，已有曲目时增量
  if (scanDirs.value.length > 0) {
    libraryStore.startScan(libraryStore.tracks.length > 0);
  }
});

onUnmounted(() => {
  libraryStore.unsubscribeScanProgress();
});
</script>

<template>
  <div class="flex flex-col h-full">
    <!-- 顶栏 -->
    <div class="shrink-0 px-5 pb-2">
      <div class="flex items-center justify-between mt-2 mb-4">
        <div class="flex items-baseline gap-4">
          <h1 class="text-3xl font-bold text-on-surface text-balance">{{ t("library.title") }}</h1>
          <!-- 统计或进度 -->
          <Transition name="fade" mode="out-in">
            <div
              v-if="scanning && scanProgress"
              key="progress"
              class="flex items-center gap-2 text-sm text-on-surface-variant/50"
            >
              <SLoading class="size-3.5 text-primary shrink-0" />
              <span class="tabular-nums">
                {{
                  t("library.scanProgress", {
                    scanned: scanProgress.scanned,
                    total: scanProgress.total,
                  })
                }}
              </span>
              <span class="text-on-surface-variant/40">{{ scanPercent }}%</span>
            </div>
            <div
              v-else-if="tracks.length > 0"
              key="stats"
              class="flex items-center gap-3 text-sm text-on-surface-variant/50"
            >
              <span class="flex items-center gap-1">
                <IconLucideMusic class="size-3.5" />
                {{ t("common.totalSongs", { count: tracks.length }) }}
              </span>
              <span v-if="totalSize" class="flex items-center gap-1">
                <IconLucideHardDrive class="size-3.5" />
                {{ totalSize }}
              </span>
            </div>
          </Transition>
        </div>
        <SButton
          variant="tertiary"
          circle
          :title="t(libraryView === 'songs' ? 'library.switchToAlbums' : 'library.switchToSongs')"
          :aria-label="
            t(libraryView === 'songs' ? 'library.switchToAlbums' : 'library.switchToSongs')
          "
          @click="libraryView = libraryView === 'songs' ? 'albums' : 'songs'"
        >
          <template #icon>
            <IconLucideLayoutGrid v-if="libraryView === 'songs'" />
            <IconLucideList v-else />
          </template>
        </SButton>
      </div>
      <div class="flex flex-wrap items-center justify-between gap-4">
        <div class="flex items-center gap-3">
          <SButton
            type="primary"
            variant="secondary"
            round
            :disabled="tracks.length === 0"
            @click="handlePlayAll"
          >
            <template #icon>
              <IconLucidePlay />
            </template>
            {{ t("common.playAll") }}
          </SButton>
          <SButton
            variant="secondary"
            circle
            :disabled="scanning || scanDirs.length === 0"
            @click="libraryStore.startScan(true)"
          >
            <template #icon>
              <IconLucideRefreshCw :class="{ 'animate-spin': scanning }" />
            </template>
          </SButton>
          <SDropdownMenu :items="moreMenuItems" align="start" @select="handleMoreMenu">
            <template #trigger>
              <SButton variant="secondary" circle>
                <template #icon>
                  <IconLucideEllipsis />
                </template>
              </SButton>
            </template>
          </SDropdownMenu>
        </div>
        <div class="flex flex-wrap items-center justify-end gap-3">
          <div
            v-show="libraryView === 'albums'"
            ref="organizationToolbar"
            class="flex flex-wrap items-center gap-2"
          />
          <div class="w-40"><SSelect v-model="sourceFilter" :options="sourceOptions" /></div>
          <SInput
            v-model="searchQuery"
            :placeholder="t('common.search')"
            clearable
            round
            class="w-40 focus-within:w-56"
            data-search-input
          >
            <template #prefix>
              <IconLucideSearch class="size-4 text-on-surface-variant/40 shrink-0" />
            </template>
          </SInput>
        </div>
      </div>
    </div>
    <!-- 曲目列表 -->
    <div v-if="tracks.length > 0" class="flex-1 min-h-0">
      <UnifiedCatalogView
        v-if="libraryView === 'albums'"
        mode="album"
        :items="albumItems"
        :toolbar-target="organizationToolbar"
      />
      <SongList
        v-else
        ref="songListRef"
        :items="tracks"
        :search-query="searchQuery"
        :playback-context="playbackContext"
        sort-key="library"
        enable-sort
        show-size
      />
    </div>
    <!-- 空状态：无目录或无歌曲 -->
    <div v-else class="flex-1 flex items-center justify-center">
      <div class="text-center text-on-surface-variant/50">
        <IconLucideMusic class="size-12 mx-auto mb-3 opacity-30" />
        <div class="text-sm mb-1">{{ t("library.empty") }}</div>
        <div class="text-xs mb-4 opacity-70">{{ t("library.emptyHint") }}</div>
        <SButton type="primary" variant="secondary" @click="handleQuickAddFolder">
          <template #icon><IconLucideFolderPlus /></template>
          {{ t("library.addFolder") }}
        </SButton>
      </div>
    </div>
    <!-- 文件夹管理 -->
    <SDialog
      v-model:open="folderDialogOpen"
      :title="t('library.folders')"
      :description="t('library.foldersDescription')"
      width="480px"
    >
      <FolderManager @added="handleFolderAdded" />
    </SDialog>
  </div>
</template>
