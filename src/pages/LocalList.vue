<script setup lang="ts">
defineOptions({ name: "LocalList" });

import type { CoverItem } from "@/types/artist";
import type { SSelectOption } from "@/components/ui/SSelect.vue";
import { useUnifiedLibrary } from "@/composables/useUnifiedLibrary";
import { unifiedCoverItems } from "@/utils/unifiedLibrary";
import IconLucideUsers from "~icons/lucide/users";
import IconLucideUserRound from "~icons/lucide/user-round";
import IconLucideMusic from "~icons/lucide/music";
import IconLucideDisc3 from "~icons/lucide/disc-3";
import IconLucideArrowUpDown from "~icons/lucide/arrow-up-down";

type Mode = "artist" | "album";
type SortMode = "default" | "name" | "trackCount";

const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const { library: libraryStore, streaming, sourceFilter, sourceOptions } = useUnifiedLibrary();

const mode = computed<Mode>(() => (route.name === "album-list" ? "album" : "artist"));

const sortMode = ref<SortMode>("default");

const sortOptions = computed<SSelectOption[]>(() => [
  { value: "default", label: t("songList.sort.default") },
  { value: "name", label: t("songList.sort.byName") },
  { value: "trackCount", label: t("songList.sort.byTrackCount") },
]);

/** 组装统一封面列表并应用来源筛选 */
const items = computed<CoverItem[]>(() => {
  const names = Object.fromEntries(streaming.servers.map((server) => [server.id, server.name]));
  names.local = t("library.sources.local");
  const list = unifiedCoverItems(
    mode.value,
    libraryStore.tracks,
    streaming.catalog,
    names,
    libraryStore.artistAvatars,
  ).filter(
    (item) =>
      sourceFilter.value === "all" ||
      (item.source === "local"
        ? sourceFilter.value === "local"
        : item.serverId === sourceFilter.value),
  );
  if (sortMode.value === "name") {
    list.sort((a, b) => a.title.localeCompare(b.title));
  } else if (sortMode.value === "trackCount") {
    list.sort((a, b) => b.trackCount - a.trackCount || a.title.localeCompare(b.title));
  }
  return list;
});

const config = computed(() =>
  mode.value === "artist"
    ? {
        title: t("artist.label"),
        countIcon: IconLucideUsers,
        countLabel: t("artist.totalArtists", { count: items.value.length }),
        emptyIcon: IconLucideUserRound,
        coverType: "artist" as const,
        minSize: 120,
        selectWidth: "w-32",
      }
    : {
        title: t("album.label"),
        countIcon: IconLucideDisc3,
        countLabel: t("common.totalAlbums", { count: items.value.length }),
        emptyIcon: IconLucideDisc3,
        coverType: "default" as const,
        minSize: 140,
        selectWidth: "w-40",
      },
);

const organizationToolbar = shallowRef<HTMLElement | null>(null);
</script>

<template>
  <div class="flex flex-col h-full">
    <div class="shrink-0 px-5 pb-2">
      <div class="flex flex-wrap items-center justify-between gap-4 mt-2 mb-4">
        <div class="flex items-baseline gap-4">
          <h1 class="text-3xl font-bold text-on-surface text-balance">{{ config.title }}</h1>
          <span
            v-if="items.length > 0"
            class="flex items-center gap-1 text-sm text-on-surface-variant/50"
          >
            <component :is="config.countIcon" class="size-3.5" />
            {{ config.countLabel }}
          </span>
        </div>
        <div class="flex items-center gap-2 text-sm text-on-surface-variant/70">
          <div class="w-40"><SSelect v-model="sourceFilter" :options="sourceOptions" /></div>
          <div ref="organizationToolbar" class="flex items-center gap-2 flex-wrap" />
          <template v-if="mode === 'artist'">
            <IconLucideArrowUpDown class="size-3.5 shrink-0" />
            <span class="shrink-0">{{ t("songList.sort.mode") }}</span>
            <div :class="[config.selectWidth, 'shrink-0']">
              <SSelect v-model="sortMode" :options="sortOptions" />
            </div>
          </template>
        </div>
      </div>
    </div>
    <div class="flex-1 min-h-0">
      <UnifiedCatalogView
        v-if="items.length > 0"
        :items="items"
        :mode="mode"
        :toolbar-target="organizationToolbar"
      />
      <div v-else class="h-full flex items-center justify-center">
        <div class="text-center text-on-surface-variant/50">
          <component :is="config.emptyIcon" class="size-12 mx-auto mb-3 opacity-30" />
          <div class="text-sm mb-1">{{ t("library.noUnifiedData") }}</div>
          <div class="text-xs mb-4 opacity-70">{{ t("library.noUnifiedDataHint") }}</div>
          <SButton type="primary" variant="secondary" @click="router.push('/library')">
            <template #icon><IconLucideMusic /></template>
            {{ t("library.goLibrary") }}
          </SButton>
        </div>
      </div>
    </div>
  </div>
</template>
