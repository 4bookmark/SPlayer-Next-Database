<script setup lang="ts">
import type { OrganizationAction } from "@shared/types/streaming";
import { artistCategoryId } from "@shared/utils/artistGroups";
import { toast } from "@/composables/useToast";
import ArtistMergeDialog from "@/components/modals/ArtistMergeDialog.vue";
import type { CoverItem } from "@/types/artist";
import { artistToCoverItem } from "@/utils/format/coverItem";

const { t } = useI18n();
const props = defineProps<{
  artists: import("@shared/types/player").Artist[];
  organization: import("@shared/types/streaming").StreamingOrganization;
  serverId?: string;
  toolbarTarget?: HTMLElement | null;
  loading?: boolean;
}>();
const emit = defineEmits<{ openArtist: [CoverItem]; updated: [] }>();
const { artists, organization } = toRefs(props);
const selecting = ref(false);
const selectedIds = ref<string[]>([]);
const mergeOpen = ref(false);
const busy = ref(false);
const filter = ref("all");
const destination = ref("");
const manageOpen = ref(false);
const categories = computed(() => organization.value.artistCategoryDefinitions ?? []);
const options = computed(() => [
  { value: "all", label: t("organization.all") },
  ...categories.value.map((category) => ({ value: category.id, label: category.name })),
  { value: "uncategorized", label: t("organization.uncategorized") },
]);
const destinationOptions = computed(() => [
  { value: "", label: t("organization.uncategorized") },
  ...categories.value.map((category) => ({ value: category.id, label: category.name })),
]);
const selectedArtists = computed(() =>
  artists.value.filter((a) => a.id && selectedIds.value.includes(a.id)),
);
const canUnmerge = computed(
  () =>
    selectedIds.value.length === 1 &&
    organization.value.artistGroups.some((g) => g.targetId === selectedIds.value[0]),
);
watch(
  () => props.serverId,
  () => {
    selectedIds.value = [];
    selecting.value = false;
    mergeOpen.value = false;
    manageOpen.value = false;
    filter.value = "all";
  },
);
watch(artists, () => {
  selectedIds.value = selectedIds.value.filter((id) => artists.value.some((a) => a.id === id));
});
/** 取消选择并退出批量模式 */
const cancelSelection = (): void => {
  selecting.value = false;
  selectedIds.value = [];
};
/** 保存歌手整理操作，分类和合并使用独立的本地覆盖 */
const save = async (action: OrganizationAction): Promise<void> => {
  if (busy.value) return;
  const serverId = props.serverId;
  if (!serverId) return;
  busy.value = true;
  try {
    await window.api.streaming.organize(
      serverId,
      JSON.parse(JSON.stringify(action)) as OrganizationAction,
    );
    emit("updated");
    if (serverId !== props.serverId) return;
    if (action.type === "merge" || action.type === "unmerge" || action.type === "artist-classify") {
      mergeOpen.value = false;
      cancelSelection();
    }
    if (!options.value.some((option) => option.value === filter.value)) filter.value = "all";
    toast.success(t("organization.saved"));
  } catch (error) {
    toast.error(String(error));
  } finally {
    busy.value = false;
  }
};
/** 指定保留的歌手，或撤销当前选中的合并组 */
const saveMerge = (targetId?: string): Promise<void> =>
  save(
    targetId
      ? { type: "merge", targetId, selectedIds: [...selectedIds.value] }
      : { type: "unmerge", targetId: selectedIds.value[0]! },
  );

const items = computed<CoverItem[]>(() =>
  artists.value.map((a) => ({
    ...artistToCoverItem(a),
    subtitle: a.albumCount ? t("common.totalAlbums", { count: a.albumCount }) : "",
  })),
);

const visible = computed(() =>
  items.value.filter(
    (item) =>
      filter.value === "all" ||
      (artistCategoryId(organization.value, item.id) || "uncategorized") === filter.value,
  ),
);
const groups = computed(() =>
  [...categories.value, { id: "uncategorized", name: t("organization.uncategorized") }]
    .map((category) => {
      const groupItems = visible.value.filter(
        (item) =>
          (artistCategoryId(organization.value, item.id) || "uncategorized") === category.id,
      );
      return { id: category.id, title: `${groupItems.length} ${category.name}`, items: groupItems };
    })
    .filter((group) => group.items.length > 0),
);

/**
 * 打开当前服务器的歌手
 * @param item - 歌手封面条目
 */
const handleClick = (item: CoverItem): void => {
  if (selecting.value) {
    selectedIds.value = selectedIds.value.includes(item.id)
      ? selectedIds.value.filter((id) => id !== item.id)
      : [...selectedIds.value, item.id];
    return;
  }
  emit("openArtist", item);
};
</script>

<template>
  <div class="h-full flex flex-col">
    <Teleport :to="toolbarTarget ?? 'body'" :disabled="!toolbarTarget">
      <div
        v-if="artists.length"
        class="flex justify-end gap-2 items-center flex-wrap shrink-0"
        :class="toolbarTarget ? 'py-1' : 'px-5 py-3'"
      >
        <div class="w-36 shrink-0">
          <SSelect v-model="filter" :options="options" :disabled="busy" />
        </div>
        <SButton v-if="serverId && !selecting" variant="secondary" round @click="selecting = true">
          {{ t("organization.select") }}
        </SButton>
        <template v-else-if="serverId">
          <SButton :disabled="busy" @click="cancelSelection">{{ t("common.cancel") }}</SButton>
          <SButton :disabled="busy" @click="selectedIds = visible.map((item) => item.id)">
            {{ t("organization.selectAll") }}
          </SButton>
          <span class="text-xs text-on-surface-variant">
            {{ t("organization.selected", { count: selectedIds.length }) }}
          </span>
          <SButton
            type="primary"
            :disabled="busy || selectedIds.length < 2"
            @click="mergeOpen = true"
          >
            {{ t("organization.merge") }}
          </SButton>
          <SButton v-if="canUnmerge" :disabled="busy" @click="saveMerge()">
            {{ t("organization.unmerge") }}
          </SButton>
          <div class="w-36 shrink-0">
            <SSelect v-model="destination" :options="destinationOptions" :disabled="busy" />
          </div>
          <SButton
            :disabled="busy || !selectedIds.length"
            @click="
              save({ type: 'artist-classify', artistIds: selectedIds, categoryId: destination })
            "
          >
            {{ t("organization.assign") }}
          </SButton>
        </template>
        <SButton
          v-if="serverId"
          variant="ghost"
          circle
          :disabled="busy"
          :title="t('organization.manageArtistCategories')"
          :aria-label="t('organization.manageArtistCategories')"
          @click="manageOpen = true"
        >
          <template #icon><IconLucideSettings2 /></template>
        </SButton>
      </div>
    </Teleport>
    <div class="flex-1 min-h-0">
      <GroupedCoverList
        v-if="artists.length > 0"
        :groups="groups"
        :selecting="selecting"
        :selected-ids="selectedIds"
        type="artist"
        :min-size="120"
        :padding-x="20"
        :padding-top="8"
        :padding-bottom="20"
        @click="handleClick"
      />
      <div v-else class="h-full flex items-center justify-center">
        <div class="text-center text-on-surface-variant/60">
          <IconLucideUserRound class="size-12 mx-auto mb-3 opacity-30" />
          <div class="text-sm">
            {{ loading ? t("common.loading") : t("streaming.empty.noResults") }}
          </div>
        </div>
      </div>
    </div>
    <CategoryManagerDialog
      v-model:open="manageOpen"
      :title="t('organization.manageArtistCategories')"
      :categories="categories"
      :busy="busy"
      :description="t('organization.artistCategoryHint')"
      @create="save({ type: 'artist-category-create', name: $event })"
      @rename="(id, name) => save({ type: 'artist-category-rename', id, name })"
      @delete="save({ type: 'artist-category-delete', id: $event })"
    />
    <ArtistMergeDialog
      v-model:open="mergeOpen"
      :artists="selectedArtists"
      :busy="busy"
      @confirm="saveMerge"
    />
  </div>
</template>
