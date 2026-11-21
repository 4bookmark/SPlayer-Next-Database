import { flushPromises, mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { expect, it, vi } from "vitest";
import { emptyOrganization } from "@shared/utils/artistGroups";
import english from "@/i18n/locales/en-US.json";
import ArtistOrganization from "./ArtistOrganization.vue";
vi.mock("@/composables/useToast", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
it("共用艺术家组件沿用分类分段、多选和指定合并目标，操作始终保存到传入服务器", async () => {
  const organize = vi.fn(async () => ({}));
  Object.assign(window, { api: { streaming: { organize } } });
  const wrapper = mount(ArtistOrganization, {
    props: {
      serverId: "other-server",
      artists: [
        { id: "a", name: "Artist A" },
        { id: "b", name: "Artist B" },
      ],
      organization: {
        ...emptyOrganization(),
        artistCategoryDefinitions: [{ id: "region", name: "Region" }],
        artistCategories: { a: "region" },
      },
    },
    global: {
      plugins: [createI18n({ legacy: false, locale: "en", messages: { en: english } })],
      stubs: {
        SButton: { template: "<button><slot/></button>" },
        SSelect: true,
        CategoryManagerDialog: true,
        ArtistMergeDialog: {
          name: "ArtistMergeDialog",
          props: ["open", "artists"],
          emits: ["confirm"],
          template: "<div/>",
        },
        GroupedCoverList: {
          props: ["groups"],
          emits: ["click"],
          template:
            '<div><section v-for="group in groups" :key="group.id"><h2>{{group.title}}</h2><button v-for="item in group.items" :key="item.id" @click="$emit(\'click\',item)">{{item.title}}</button></section></div>',
        },
      },
    },
  });
  expect(wrapper.findAll("h2").map((el) => el.text())).toEqual(["1 Region", "1 Uncategorized"]);
  await wrapper
    .findAll("button")
    .find((el) => el.text() === "Select")!
    .trigger("click");
  await wrapper.findAll("section button")[0].trigger("click");
  await wrapper.findAll("section button")[1].trigger("click");
  const merge = wrapper.findComponent({ name: "ArtistMergeDialog" });
  expect(merge.props("artists")).toHaveLength(2);
  merge.vm.$emit("confirm", "b");
  await flushPromises();
  expect(organize).toHaveBeenCalledWith("other-server", {
    type: "merge",
    targetId: "b",
    selectedIds: ["a", "b"],
  });
  expect(wrapper.emitted("updated")).toHaveLength(1);
});
