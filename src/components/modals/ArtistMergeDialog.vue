<script setup lang="ts">
import type { Artist } from "@shared/types/player";
const props = defineProps<{ open: boolean; artists: Artist[]; busy: boolean }>();
const emit = defineEmits<{ "update:open": [boolean]; confirm: [string] }>();
const { t } = useI18n();
const target = ref("");
watch(
  () => props.open,
  () => {
    target.value = "";
  },
);
</script>
<template>
  <SDialog
    :open="open"
    :title="t('organization.mergeArtists')"
    :description="t('organization.chooseTarget')"
    @update:open="emit('update:open', $event)"
  >
    <div class="flex flex-col gap-2 max-h-72 overflow-auto px-1 py-2">
      <label
        v-for="artist in artists"
        :key="artist.id"
        class="flex items-center gap-3 p-3 rounded-lg hover:bg-primary/10 cursor-pointer"
      >
        <input
          v-model="target"
          type="radio"
          name="merge-target"
          :value="artist.id"
          :disabled="busy"
        />
        <span class="text-sm">{{ artist.name }}</span>
      </label>
    </div>
    <template #footer>
      <SButton :disabled="busy" @click="emit('update:open', false)">
        {{ t("common.cancel") }}
      </SButton>
      <SButton
        type="primary"
        :disabled="busy || !artists.some((a) => a.id === target)"
        @click="emit('confirm', target)"
      >
        {{ t("organization.merge") }}
      </SButton>
    </template>
  </SDialog>
</template>
