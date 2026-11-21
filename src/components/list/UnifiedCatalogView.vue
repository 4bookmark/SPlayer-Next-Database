<script setup lang="ts">
import type { CoverItem } from "@/types/artist";
import type { StreamingOrganization } from "@shared/types/streaming";
import { emptyOrganization } from "@shared/utils/artistGroups";
import { useStreamingStore } from "@/stores/streaming";
import { navigateToAlbum, navigateToArtist } from "@/utils/navigate";

const props = defineProps<{
  mode: "album" | "artist";
  items: CoverItem[];
  toolbarTarget?: HTMLElement | null;
}>();
const { t } = useI18n();
const streaming = useStreamingStore();
/** 单来源时直接复用该服务器的整理操作，多来源汇总只展示各自规则 */
const serverId = computed(() => {
  if (!props.items.length || props.items.some((item) => item.source !== "streaming"))
    return undefined;
  const ids = new Set(props.items.map((item) => item.serverId));
  return ids.size === 1 ? [...ids][0] : undefined;
});
const scopedItems = computed(() =>
  props.items.map((item) => ({
    ...item,
    id: serverId.value ? item.originalId! : item.id,
  })),
);
/** 汇总时为自定义词条和资源 ID 加入服务器命名空间，避免同名 ID 串用规则 */
const organization = computed<StreamingOrganization>(() => {
  const rules = streaming.catalog.organizations ?? {};
  if (serverId.value) return rules[serverId.value] ?? emptyOrganization();
  const result = emptyOrganization();
  result.artistCategories = {};
  result.artistCategoryDefinitions = [];
  for (const server of streaming.servers) {
    const rule = rules[server.id];
    if (!rule) continue;
    const prefix = `streaming:${server.id}:`;
    const customIds = new Set(rule.categories.map((category) => category.id));
    result.categories.push(
      ...rule.categories.map((category) => ({
        id: prefix + category.id,
        name: `${category.name} · ${server.name}`,
      })),
    );
    for (const [id, category] of Object.entries(rule.albumCategories))
      result.albumCategories[prefix + id] = customIds.has(category) ? prefix + category : category;
    result.artistCategoryDefinitions.push(
      ...(rule.artistCategoryDefinitions ?? []).map((category) => ({
        id: prefix + category.id,
        name: `${category.name} · ${server.name}`,
      })),
    );
    for (const [id, category] of Object.entries(rule.artistCategories ?? {}))
      result.artistCategories[prefix + id] = category ? prefix + category : "";
    result.artistGroups.push(
      ...rule.artistGroups.map((group) => ({
        targetId: prefix + group.targetId,
        memberIds: group.memberIds.map((id) => prefix + id),
      })),
    );
  }
  return result;
});
const artists = computed(() => {
  const byId = new Map(
    streaming.catalog.artists.map((artist) => [
      JSON.stringify([artist.serverId, artist.id]),
      artist,
    ]),
  );
  return scopedItems.value.map((item) => ({
    id: item.id,
    name: item.title,
    serverId: item.serverId,
    avatar: item.cover,
    albumCount: byId.get(JSON.stringify([item.serverId, item.originalId]))?.albumCount,
  }));
});
/**
 * 使用卡片记录的真实来源导航，整理组件的展示 ID 不进入播放器
 * @param item - 被点击的展示卡片
 */
const open = (item: CoverItem): void => {
  const original = scopedItems.value.find((candidate) => candidate.id === item.id);
  if (!original) return;
  const options = { source: original.source, serverId: original.serverId };
  if (props.mode === "artist")
    navigateToArtist(original.title, { ...options, artistId: original.originalId });
  else navigateToAlbum(original.title, { ...options, albumId: original.originalId });
};
</script>
<template>
  <div class="h-full flex flex-col">
    <p
      v-if="!serverId && items.some((item) => item.source === 'streaming')"
      class="px-5 py-1 text-xs text-on-surface-variant/60"
    >
      {{ t("library.sources.organizeHint") }}
    </p>
    <div class="flex-1 min-h-0">
      <ArtistOrganization
        v-if="mode === 'artist'"
        :artists="artists"
        :organization="organization"
        :server-id="serverId"
        :toolbar-target="toolbarTarget"
        @open-artist="open"
        @updated="streaming.refreshCatalog()"
      />
      <AlbumOrganization
        v-else
        :items="scopedItems"
        :organization="organization"
        :server-id="serverId"
        :toolbar-target="toolbarTarget"
        @open-album="open"
      />
    </div>
  </div>
</template>
