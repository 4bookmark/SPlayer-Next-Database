import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mount, type VueWrapper } from "@vue/test-utils";
import { defineComponent, h, nextTick, ref, toRaw, type PropType } from "vue";
import type { CoverItem } from "@/types/artist";
import SVirtualList, { type SVirtualListProps } from "@/components/ui/SVirtualList.vue";
import GroupedCoverList, { type CoverGroup } from "./GroupedCoverList.vue";

const dimensions = vi.hoisted(() => ({ width: 1000, height: 600 }));
const floating = vi.hoisted(() => ({ enabled: false }));
vi.mock("@vueuse/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@vueuse/core")>();
  const vue = await import("vue");
  const width = vue.ref(dimensions.width);
  const height = vue.ref(dimensions.height);
  return { ...actual, useElementSize: () => ({ width, height }), __testWidth: width };
});
vi.mock("@/composables/useFloatingPlayerBar", async () => {
  const vue = await import("vue");
  return {
    useFloatingPlayerBar: () => ({ isFloatingBar: vue.ref(floating.enabled), PLAYER_BAR_GAP: 112 }),
  };
});

const CoverCard = defineComponent({
  props: {
    item: { type: Object as PropType<CoverItem>, required: true },
    selecting: Boolean,
    selected: Boolean,
    type: String,
  },
  emits: ["click"],
  /** 用轻量卡片隔离图片解码，只验证虚拟列表真实挂载的条目 */
  setup(props, { emit }) {
    return () =>
      h(
        "button",
        {
          "data-cover-id": props.item.id,
          "data-type": props.type,
          "aria-pressed": props.selecting ? String(!!props.selected) : undefined,
          onClick: () => emit("click"),
        },
        props.item.title,
      );
  },
});

/** 生成具有原始服务端标识的分类数据
 * @param count - 每个分类的封面数量
 * @returns 分类数据
 */
function makeGroups(count: number): CoverGroup[] {
  return ["albums", "singles", "other"].map((id) => ({
    id,
    title: `${id} (${count})`,
    items: Array.from({ length: count }, (_, index) => ({
      id: `${id}/${index}`,
      title: `Album ${index}`,
      trackCount: 12,
    })),
  }));
}

/** 读取泛型虚拟列表的公开参数
 * @param view - 分类列表包装器
 * @returns 虚拟列表参数
 */
function virtualProps(view: VueWrapper): SVirtualListProps<unknown> {
  return view.findComponent(SVirtualList).props() as SVirtualListProps<unknown>;
}

let wrapper: VueWrapper | undefined;

/** 装载真实虚拟列表并等待响应式尺寸计算
 * @param groups - 分类数据
 * @returns 页面包装器
 */
async function render(groups: CoverGroup[]): Promise<VueWrapper> {
  wrapper = mount(GroupedCoverList, {
    props: { groups },
    global: { components: { SVirtualList, CoverCard } },
  });
  await nextTick();
  await nextTick();
  return wrapper;
}

/** 模拟用户滚动并执行虚拟列表的下一帧计算
 * @param view - 列表包装器
 * @param top - 滚动像素位置
 */
async function scroll(view: VueWrapper, top: number): Promise<void> {
  const element = view.find(".overflow-y-auto");
  element.element.scrollTop = top;
  await element.trigger("scroll");
  await vi.advanceTimersByTimeAsync(20);
  await nextTick();
}

beforeEach(async () => {
  vi.useFakeTimers();
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
    setTimeout(() => callback(0), 0),
  );
  vi.stubGlobal("cancelAnimationFrame", clearTimeout);
  floating.enabled = false;
  const vueuse = (await import("@vueuse/core")) as unknown as {
    __testWidth: ReturnType<typeof ref<number>>;
  };
  vueuse.__testWidth.value = 1000;
});
afterEach(() => {
  wrapper?.unmount();
  wrapper = undefined;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("GroupedCoverList", () => {
  it("keeps thousands of album cards bounded and reaches the final category in one viewport", async () => {
    const groups = makeGroups(1001);
    const view = await render(groups);
    expect(view.findAllComponents(SVirtualList)).toHaveLength(1);
    expect(view.findAll("[data-cover-id]").length).toBeGreaterThan(6);
    expect(view.findAll("[data-cover-id]").length).toBeLessThan(100);
    expect(view.find('[data-category="albums"]').text()).toBe("albums (1001)");
    expect(view.find('[data-category="other"]').exists()).toBe(false);

    const items = virtualProps(view).items as { kind: string; group?: CoverGroup }[];
    const finalHeader = items.findIndex((row) => row.group?.id === "other");
    const heights = virtualProps(view).exactItemHeights as number[];
    await scroll(view, 8 + heights.slice(0, finalHeader).reduce((sum, value) => sum + value, 0));
    expect(view.find('[data-category="other"]').text()).toBe("other (1001)");
    expect(view.find('[data-cover-id="other/0"]').exists()).toBe(true);
    expect(view.find('[data-cover-id="albums/0"]').exists()).toBe(false);
    expect(view.findAll("[data-cover-id]").length).toBeLessThan(100);
  });

  it("preserves card identity and click payload, selection, artist type, and height references", async () => {
    const groups = makeGroups(4);
    const original = groups[0].items[0];
    const view = await render(groups);
    const heights = virtualProps(view).exactItemHeights;
    await view.setProps({ selecting: true, selectedIds: [original.id], type: "artist" });
    const card = view.find('[data-cover-id="albums/0"]');
    expect(card.attributes("aria-pressed")).toBe("true");
    expect(card.attributes("data-type")).toBe("artist");
    expect(view.find('[data-cover-id="albums/1"]').attributes("aria-pressed")).toBe("false");
    await card.trigger("click");
    expect(toRaw(view.emitted("click")?.[0]?.[0])).toBe(original);
    expect(virtualProps(view).exactItemHeights).toBe(heights);
  });

  it("reflows cards on resize and keeps category positions accurate without ID collisions", async () => {
    const duplicate: CoverItem = { id: "same", title: "Shared", trackCount: 1 };
    const groups = makeGroups(13);
    groups[0].items[0] = duplicate;
    groups[1].items[0] = duplicate;
    const view = await render(groups);
    expect(view.find(".grid").attributes("style")).toContain("repeat(6,");
    const getKey = virtualProps(view).getItemKey as (row: unknown, index: number) => string;
    const items = virtualProps(view).items as unknown[];
    expect(new Set(items.map(getKey)).size).toBe(items.length);
    const originalHeights = virtualProps(view).exactItemHeights;

    const vueuse = (await import("@vueuse/core")) as unknown as {
      __testWidth: ReturnType<typeof ref<number>>;
    };
    vueuse.__testWidth.value = 520;
    await nextTick();
    await nextTick();
    expect(view.find(".grid").attributes("style")).toContain("repeat(3,");
    expect(virtualProps(view).exactItemHeights).not.toBe(originalHeights);
    const narrowItems = virtualProps(view).items as { group?: CoverGroup }[];
    const heights = virtualProps(view).exactItemHeights as number[];
    expect(heights.filter((height) => height === 64)).toHaveLength(3);
    const index = narrowItems.findIndex((row) => row.group?.id === "other");
    await scroll(view, 8 + heights.slice(0, index).reduce((sum, height) => sum + height, 0));
    expect(view.find('[data-category="other"]').text()).toBe("other (13)");
    expect(view.find('[data-cover-id="other/0"]').exists()).toBe(true);

    vueuse.__testWidth.value = 0;
    await nextTick();
    expect(view.find(".grid").attributes("style")).toContain("repeat(3,");
  });

  it("reserves floating playback space while keeping all groups in the same scroller", async () => {
    floating.enabled = true;
    const view = await render(makeGroups(1));
    expect(virtualProps(view).paddingBottom).toBe(112);
    expect(view.findAll(".overflow-y-auto")).toHaveLength(1);
    expect(view.findAll("[data-category]").map((header) => header.text())).toEqual([
      "albums (1)",
      "singles (1)",
      "other (1)",
    ]);
  });
  it("时间线在年份节点与封面行之间连续显示虚线，封面信息保持下方布局", async () => {
    const view = await render(makeGroups(3));
    await view.setProps({ timeline: true });
    await nextTick();
    expect(view.findAll(".timeline-line").length).toBeGreaterThan(1);
    const grid = view.find(".grid");
    expect(grid.attributes("style")).toContain("height:");
    expect(grid.attributes("style")).toContain("padding-left: 52px");
    expect(view.findAll("h2")[0].text()).toBe("albums (3)");
    await view.find("[data-cover-id]").trigger("click");
    expect(view.emitted("click")?.[0]?.[0]).toMatchObject({ id: "albums/0" });
  });
});
