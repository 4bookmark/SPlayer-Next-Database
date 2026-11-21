<script setup lang="ts">
import type { CoverItem } from "@/types/artist";
import type { SVirtualListExposed } from "@/components/ui/SVirtualList.vue";
import { useFloatingPlayerBar } from "@/composables/useFloatingPlayerBar";

export interface CoverGroup {
  id: string;
  title: string;
  items: CoverItem[];
}

export interface GroupedCoverListProps {
  groups: CoverGroup[];
  type?: "default" | "artist";
  timeline?: boolean;
  selecting?: boolean;
  selectedIds?: string[];
  minSize?: number;
  gap?: number;
  paddingX?: number;
  paddingTop?: number;
  paddingBottom?: number;
}

const props = withDefaults(defineProps<GroupedCoverListProps>(), {
  type: "default",
  minSize: 140,
  gap: 20,
  paddingX: 20,
  paddingTop: 8,
  paddingBottom: 24,
});
const emit = defineEmits<{ click: [item: CoverItem] }>();
const { isFloatingBar, PLAYER_BAR_GAP } = useFloatingPlayerBar();
const virtualPaddingBottom = computed(() =>
  isFloatingBar.value ? PLAYER_BAR_GAP : props.paddingBottom,
);
const virtualListRef = ref<SVirtualListExposed | null>(null);
const scrollEl = computed(() => virtualListRef.value?.scrollRef ?? null);
const { width: scrollWidth } = useElementSize(scrollEl);
let lastValidWidth = 0;
const timelineGutter = computed(() => (props.timeline ? 32 : 0));
const innerWidth = computed(() => {
  if (scrollWidth.value > 0) lastValidWidth = scrollWidth.value;
  return Math.max(
    0,
    (scrollWidth.value || lastValidWidth) - props.paddingX * 2 - timelineGutter.value,
  );
});
const columnCount = computed(() =>
  innerWidth.value > 0
    ? Math.max(1, Math.floor((innerWidth.value + props.gap) / (props.minSize + props.gap)))
    : 1,
);
const colWidth = computed(() =>
  innerWidth.value > 0
    ? (innerWidth.value - (columnCount.value - 1) * props.gap) / columnCount.value
    : props.minSize,
);
const rowHeight = computed(() => colWidth.value + 76 + props.gap);

interface HeaderRow {
  kind: "header";
  key: string;
  group: CoverGroup;
}
interface CardRow {
  kind: "cards";
  key: string;
  items: CoverItem[];
}
type Row = HeaderRow | CardRow;

/** 把分类标题和封面行合并，全部分类共享同一滚动窗口 */
const rows = computed<Row[]>(() => {
  const result: Row[] = [];
  const cols = columnCount.value;
  for (const group of props.groups) {
    result.push({ kind: "header", key: JSON.stringify([group.id, "header"]), group });
    for (let index = 0; index < group.items.length; index += cols) {
      const items = group.items.slice(index, index + cols);
      result.push({ kind: "cards", key: JSON.stringify([group.id, "cards", items[0].id]), items });
    }
  }
  return result;
});

/** 精确高度数组仅在分行或宽度改变时更新，选择状态不会触发重建 */
const exactItemHeights = computed(() =>
  rows.value.map((row) => (row.kind === "header" ? 64 : rowHeight.value)),
);

/** 获取带分类命名空间的行标识
 * @param row - 标题或封面行
 * @returns 稳定行标识
 */
function getRowKey(row: Row): string {
  return row.key;
}
</script>

<template>
  <SVirtualList
    ref="virtualListRef"
    :items="rows"
    :item-height="rowHeight"
    :exact-item-heights="exactItemHeights"
    :get-item-key="getRowKey"
    :padding-top="paddingTop"
    :padding-bottom="virtualPaddingBottom"
    height="100%"
  >
    <template #default="{ item: row }: { item: Row }">
      <div
        v-if="row.kind === 'header'"
        class="h-16 flex items-center relative"
        :style="{ paddingLeft: `${paddingX}px`, paddingRight: `${paddingX}px` }"
      >
        <span
          v-if="timeline"
          class="timeline-line absolute top-0 bottom-0 text-primary/35"
          :style="{ left: `${paddingX + 6}px` }"
          aria-hidden="true"
        />
        <span
          v-if="timeline"
          class="relative z-1 size-2 rounded-full bg-primary shrink-0 mr-6"
          aria-hidden="true"
        />
        <h2 :data-category="row.group.id" class="text-xl font-semibold">
          {{ row.group.title }}
        </h2>
      </div>
      <div
        v-else
        class="grid relative items-start"
        :style="{
          height: `${rowHeight}px`,
          paddingLeft: `${paddingX + timelineGutter}px`,
          paddingRight: `${paddingX}px`,
          gridTemplateColumns: `repeat(${columnCount}, minmax(0, 1fr))`,
          gap: `${gap}px`,
        }"
      >
        <span
          v-if="timeline"
          class="timeline-line absolute top-0 bottom-0 text-primary/35"
          :style="{ left: `${paddingX + 6}px` }"
          aria-hidden="true"
        />
        <CoverCard
          v-for="item in row.items"
          :key="item.id"
          :item="item"
          :type="type"
          :selecting="selecting"
          :selected="selectedIds?.includes(item.id)"
          @click="emit('click', item)"
        />
      </div>
    </template>
  </SVirtualList>
</template>

<style scoped>
.timeline-line {
  width: 0;
  border-left: 2px dashed currentColor;
  pointer-events: none;
}
</style>
