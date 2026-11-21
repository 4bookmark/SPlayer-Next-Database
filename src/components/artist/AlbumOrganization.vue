<script setup lang="ts">
import type { Track, Album } from "@shared/types/player";
import { inferAlbumCategory, albumFolderPaths } from "@shared/utils/albumCategories";
import type { CoverItem } from "@/types/artist";
import type { StreamingOrganization, OrganizationAction } from "@shared/types/streaming";
import { emptyOrganization } from "@shared/utils/artistGroups";
import { toast } from "@/composables/useToast";
const props = defineProps<{
  items: CoverItem[];
  organization?: StreamingOrganization;
  tracks?: Track[];
  serverId?: string;
  timeline?: boolean;
  toolbarTarget?: HTMLElement | null;
}>();
const emit = defineEmits<{ openAlbum: [CoverItem] }>();
const { t } = useI18n();
const loadedOrganization = shallowRef<StreamingOrganization>(emptyOrganization());
const organization = computed(() => props.organization ?? loadedOrganization.value);
const filter = ref("all");
const snapshotAlbums = shallowRef<Album[]>([]);
const selecting = ref(false);
const selectedIds = ref<string[]>([]);
const destination = ref("");
const busy = ref(false);
const manageOpen = ref(false);
const ascending = ref(false);
let revision = 0;
const categories = computed(() => [
  ...["album", "compilation", "single-ep", "live", "soundtrack"].map((id) => ({
    id,
    name: t(`organization.categories.${id}`),
  })),
  ...organization.value.categories,
]);
const options = computed(() => [
  { value: "all", label: t("organization.all") },
  ...categories.value.map((c) => ({ value: c.id, label: c.name })),
  { value: "uncategorized", label: t("organization.uncategorized") },
]);
const destinationOptions = computed(() => [
  { value: "", label: t("organization.resetAutomatic") },
  { value: "uncategorized", label: t("organization.uncategorized") },
  ...categories.value.map((c) => ({ value: c.id, label: c.name })),
]);
/** 读取独立服务器的整理规则，防止切换后的迟到响应覆盖页面 */
const reload = async (): Promise<void> => {
  const seq = ++revision;
  loadedOrganization.value = emptyOrganization();
  snapshotAlbums.value = [];
  filter.value = "all";
  selectedIds.value = [];
  selecting.value = false;
  manageOpen.value = false;
  if (!props.serverId) return;
  try {
    const snapshot = await window.api.streaming.getSnapshot(props.serverId);
    if (seq === revision) {
      loadedOrganization.value = snapshot.organization ?? emptyOrganization();
      snapshotAlbums.value = snapshot.albums ?? [];
    }
  } catch (error) {
    if (seq === revision) toast.error(String(error));
  }
};
watch(() => props.serverId, reload, { immediate: true });
let activated = false;
onActivated(() => {
  if (activated) void reload();
  activated = true;
});
onBeforeUnmount(() => {
  revision++;
});
const resolvedItems = computed(() => {
  const cached = new Map(snapshotAlbums.value.map((album) => [album.id, album]));
  const paths = albumFolderPaths(props.tracks ?? []);
  return props.items.map((item) => ({
    ...item,
    cover: cached.get(item.id)?.cover ?? item.cover,
    folderPaths: [
      ...new Set([
        ...(item.folderPaths ?? []),
        ...(cached.get(item.id)?.folderPaths ?? []),
        ...(paths.get(item.id) ?? []),
      ]),
    ],
  }));
});
/** 手动指定优先，未指定时按目录类别词与音频文件数量归类 */
const categoryId = (item: CoverItem): string =>
  organization.value.albumCategories[item.id] ??
  inferAlbumCategory({
    name: item.title,
    folderPaths: item.folderPaths,
    trackCount: item.trackCount,
  }) ??
  "uncategorized";
const visible = computed(() =>
  resolvedItems.value.filter((item) => filter.value === "all" || categoryId(item) === filter.value),
);
/** 按分类直接展示发行作品，每段按年份从新到旧排列 */
const sections = computed(() =>
  [...categories.value, { id: "uncategorized", name: t("organization.uncategorized") }]
    .map((category) => ({
      ...category,
      items: visible.value
        .filter((item) => categoryId(item) === category.id)
        .sort(
          (a, b) =>
            validYear(b.year) - validYear(a.year) ||
            a.title.localeCompare(b.title) ||
            a.id.localeCompare(b.id),
        ),
    }))
    .filter((section) => section.items.length > 0),
);
/** 仅显示服务端提供的有效发行年份 */
const validYear = (year?: number): number =>
  year && Number.isInteger(year) && year > 0 && year <= 9999 ? year : 0;
const groups = computed(() => {
  const grouped = new Map<number, CoverItem[]>();
  for (const item of visible.value) {
    const year =
      item.year && Number.isInteger(item.year) && item.year > 0 && item.year <= 9999
        ? item.year
        : 0;
    grouped.set(year, [...(grouped.get(year) ?? []), item]);
  }
  return [...grouped]
    .sort(([a], [b]) => (a === 0 ? 1 : b === 0 ? -1 : ascending.value ? a - b : b - a))
    .map(([year, items]) => ({
      year,
      items: [...items].sort((a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id)),
    }));
});
/** 选择模式点击只勾选，普通模式打开专辑 */
const clickAlbum = (item: CoverItem): void => {
  if (!selecting.value) {
    emit("openAlbum", item);
    return;
  }
  selectedIds.value = selectedIds.value.includes(item.id)
    ? selectedIds.value.filter((id) => id !== item.id)
    : [...selectedIds.value, item.id];
};
/** 保存到指定服务器并更新同页分类视图 */
const save = async (action: OrganizationAction): Promise<void> => {
  if (!props.serverId || busy.value) return;
  const serverId = props.serverId;
  const seq = revision;
  busy.value = true;
  try {
    const snapshot = await window.api.streaming.organize(
      serverId,
      JSON.parse(JSON.stringify(action)) as OrganizationAction,
    );
    if (seq !== revision) return;
    loadedOrganization.value = snapshot.organization ?? emptyOrganization();
    if (action.type === "classify") {
      selectedIds.value = [];
      selecting.value = false;
    }
    if (!options.value.some((o) => o.value === filter.value)) filter.value = "all";
    toast.success(t("organization.saved"));
  } catch (error) {
    toast.error(String(error));
  } finally {
    busy.value = false;
  }
};
</script>
<template>
  <div class="h-full flex flex-col">
    <Teleport :to="toolbarTarget ?? 'body'" :disabled="!toolbarTarget">
      <div
        class="shrink-0 flex items-center justify-end gap-2 flex-wrap"
        :class="toolbarTarget ? 'py-1' : 'px-5 py-3'"
      >
        <div class="w-40 shrink-0"><SSelect v-model="filter" :options="options" /></div>
        <template v-if="serverId">
          <SButton
            variant="secondary"
            round
            :disabled="busy"
            @click="
              selecting = !selecting;
              selectedIds = [];
            "
          >
            {{ t(selecting ? "common.cancel" : "organization.select") }}
          </SButton>
          <SButton
            :disabled="busy"
            variant="ghost"
            circle
            :title="t('organization.manageCategories')"
            :aria-label="t('organization.manageCategories')"
            @click="manageOpen = true"
          >
            <template #icon><IconLucideSettings2 /></template>
          </SButton>
          <template v-if="selecting">
            <SButton :disabled="busy" @click="selectedIds = visible.map((a) => a.id)">
              {{ t("organization.selectAll") }}
            </SButton>
            <span class="text-xs">
              {{ t("organization.selected", { count: selectedIds.length }) }}
            </span>
            <div class="w-40 shrink-0">
              <SSelect v-model="destination" :options="destinationOptions" />
            </div>
            <SButton
              type="primary"
              :disabled="busy || !selectedIds.length"
              @click="save({ type: 'classify', albumIds: selectedIds, categoryId: destination })"
            >
              {{ t("organization.moveTo") }}
            </SButton>
          </template>
        </template>
        <SButton v-if="timeline" variant="secondary" round @click="ascending = !ascending">
          {{ t(ascending ? "organization.oldestFirst" : "organization.newestFirst") }}
        </SButton>
      </div>
    </Teleport>
    <div v-if="timeline" class="flex-1 min-h-0">
      <GroupedCoverList
        v-if="groups.length"
        timeline
        :groups="
          groups.map((group) => ({
            id: String(group.year),
            title: String(group.year || t('organization.unknownYear')),
            items: group.items.map((item) => ({
              ...item,
              subtitle: validYear(item.year) ? String(item.year) : t('organization.unknownYear'),
            })),
          }))
        "
        :selecting="selecting"
        :selected-ids="selectedIds"
        @click="clickAlbum"
      />
      <p v-else class="py-12 text-center text-on-surface-variant">
        {{ t("streaming.empty.noResults") }}
      </p>
    </div>
    <div v-else class="flex-1 min-h-0">
      <GroupedCoverList
        v-if="sections.length"
        :groups="
          sections.map((section) => ({
            id: section.id,
            title: `${section.items.length} ${section.name}`,
            items: section.items.map((item) => ({
              ...item,
              subtitle: validYear(item.year) ? String(item.year) : t('organization.unknownYear'),
            })),
          }))
        "
        :selecting="selecting"
        :selected-ids="selectedIds"
        @click="clickAlbum"
      />
      <p v-else class="py-12 text-center text-on-surface-variant">
        {{ t("streaming.empty.noResults") }}
      </p>
    </div>
    <CategoryManagerDialog
      v-model:open="manageOpen"
      :title="t('organization.manageCategories')"
      :categories="organization.categories"
      :busy="busy"
      :description="t('organization.deleteHint')"
      @create="save({ type: 'category-create', name: $event })"
      @rename="(id, name) => save({ type: 'category-rename', id, name })"
      @delete="save({ type: 'category-delete', id: $event })"
    />
  </div>
</template>
