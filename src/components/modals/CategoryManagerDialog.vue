<script setup lang="ts">
const props = defineProps<{
  open: boolean;
  title: string;
  categories: { id: string; name: string }[];
  busy: boolean;
  description?: string;
}>();
const emit = defineEmits<{
  "update:open": [boolean];
  create: [name: string];
  rename: [id: string, name: string];
  delete: [id: string];
}>();
const { t } = useI18n();
const name = ref("");
const editingId = ref("");
/** 切换或保存分类后清理编辑框，失败时保留输入 */
const reset = (): void => {
  name.value = "";
  editingId.value = "";
};
watch(() => props.open, reset);
watch(() => props.categories, reset);
/** 提交当前分类名称，具体归属由调用页面决定 */
const submit = (): void => {
  if (props.busy || !name.value.trim()) return;
  if (editingId.value) emit("rename", editingId.value, name.value);
  else emit("create", name.value);
};
</script>

<template>
  <SDialog :open="open" :title="title" @update:open="emit('update:open', $event)">
    <div class="flex flex-col gap-3 py-2">
      <form class="flex items-center gap-2" @submit.prevent="submit">
        <SInput
          v-model="name"
          :placeholder="t('organization.categoryName')"
          :aria-label="t('organization.categoryName')"
          :disabled="busy"
          class="flex-1"
        />
        <SButton type="primary" :disabled="busy || !name.trim()" @click="submit">
          {{ t(editingId ? "organization.rename" : "organization.add") }}
        </SButton>
        <SButton v-if="editingId" :disabled="busy" @click="reset">{{ t("common.cancel") }}</SButton>
      </form>
      <div v-for="category in categories" :key="category.id" class="flex items-center gap-2 py-2">
        <span class="flex-1 text-sm">{{ category.name }}</span>
        <SButton
          variant="ghost"
          circle
          :disabled="busy"
          :title="t('organization.rename')"
          :aria-label="`${t('organization.rename')} ${category.name}`"
          @click="
            editingId = category.id;
            name = category.name;
          "
        >
          <template #icon><IconLucidePencil /></template>
        </SButton>
        <SButton
          variant="ghost"
          circle
          :disabled="busy"
          :title="t('organization.delete')"
          :aria-label="`${t('organization.delete')} ${category.name}`"
          @click="emit('delete', category.id)"
        >
          <template #icon><IconLucideTrash2 /></template>
        </SButton>
      </div>
      <p v-if="description" class="text-xs text-on-surface-variant">{{ description }}</p>
    </div>
  </SDialog>
</template>
