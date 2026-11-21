<script setup lang="ts">
import type { OutputState } from "@shared/types/output";
import { toast } from "@/composables/useToast";
const props = defineProps<{ cover?: boolean }>();
const { t } = useI18n();
const open = ref(false);
const state = shallowRef<OutputState>({
  targets: [],
  activeId: "local",
  scanning: false,
  connecting: false,
});
let unsubscribe: (() => void) | undefined;
const active = computed(() =>
  state.value.targets.find((target) => target.id === state.value.activeId),
);
/** 扫描失败保留设备列表并显示可重试提示 */
const scan = async (): Promise<void> => {
  try {
    state.value = await window.api.output.scan();
  } catch (error) {
    toast.error(String(error));
  }
};
/** 用户明确点击后才连接，不因发现而自动播放或切换 */
const select = async (id: string): Promise<void> => {
  try {
    state.value = await window.api.output.selectTarget(id);
  } catch (error) {
    toast.error(String(error));
  }
};
onMounted(async () => {
  unsubscribe = window.api.output.onState((next) => {
    state.value = next;
  });
  try {
    state.value = await window.api.output.getState();
  } catch {
    /* 应用退出时忽略状态读取 */
  }
});
onBeforeUnmount(() => unsubscribe?.());
watch(open, (value) => {
  if (value) void scan();
});
</script>
<template>
  <SPopover
    v-model:open="open"
    trigger="click"
    side="top"
    :cover="props.cover"
    content-class="!p-0 w-80 max-h-[min(70vh,520px)] overflow-auto"
  >
    <template #trigger>
      <SButton
        :type="state.activeId !== 'local' ? 'primary' : props.cover ? 'cover' : 'default'"
        variant="ghost"
        circle
        size="large"
        :title="t('output.title')"
        :aria-label="t('output.title')"
      >
        <template #icon><IconLucideSpeaker /></template>
      </SButton>
    </template>
    <div
      class="px-4 py-3 flex items-center justify-between gap-3 border-b border-outline-variant/25"
    >
      <div class="min-w-0">
        <h3 class="font-semibold text-sm">{{ t("output.title") }}</h3>
        <p class="text-xs opacity-60 truncate">{{ active?.name ?? t("output.local") }}</p>
      </div>
      <SButton
        variant="ghost"
        circle
        :disabled="state.scanning"
        :title="t('output.scan')"
        @click="scan"
      >
        <template #icon>
          <IconLucideRefreshCw :class="state.scanning ? 'animate-spin' : ''" />
        </template>
      </SButton>
    </div>
    <div class="p-2 flex flex-col gap-1">
      <button
        v-for="target in state.targets"
        :key="target.id"
        class="output-target p-3 rounded-lg flex items-center gap-3 text-left transition-colors disabled:opacity-50"
        :class="target.id === state.activeId ? 'text-primary' : 'text-on-surface'"
        :disabled="state.connecting && target.id !== 'local'"
        @click="select(target.id)"
      >
        <IconLucideMonitorSpeaker v-if="target.protocol === 'local'" class="size-5 shrink-0" />
        <IconLucideCast v-else-if="target.protocol === 'chromecast'" class="size-5 shrink-0" />
        <IconLucideAirplay v-else-if="target.protocol === 'airplay'" class="size-5 shrink-0" />
        <IconLucideSpeaker v-else class="size-5 shrink-0" />
        <span class="flex-1 min-w-0">
          <span class="block text-sm truncate">
            {{ target.protocol === "local" ? t("output.local") : target.name }}
          </span>
          <span class="block text-xs opacity-60 truncate">
            {{
              target.protocol === "airplay"
                ? t("output.airplayPicker")
                : target.protocol === "local"
                  ? t("output.systemOutput")
                  : `${target.protocol === "sonos" ? "Sonos · UPnP" : target.protocol.toUpperCase()}${target.address ? " · " + target.address : ""}`
            }}
          </span>
          <span v-if="target.group" class="block text-xs opacity-60 truncate">
            {{ target.group }}
          </span>
        </span>
        <SLoading v-if="target.id === state.activeId && state.connecting" class="size-4" />
        <span
          v-else-if="target.id === state.activeId && !state.error"
          class="size-5 shrink-0 rounded-full border-2 border-current flex items-center justify-center"
          :aria-label="t('output.selected')"
        >
          <span class="size-2 rounded-full bg-current" />
        </span>
      </button>
      <p v-if="state.scanning" class="px-3 py-2 text-xs opacity-60">{{ t("output.scanning") }}</p>
      <p
        v-else-if="!state.targets.some((target) => !['local', 'airplay'].includes(target.protocol))"
        class="px-3 py-2 text-xs opacity-60"
      >
        {{ t("output.empty") }}
      </p>
      <p v-if="state.error" role="alert" class="px-3 py-2 text-xs text-red-500 break-words">
        {{ state.error }}
      </p>
      <p v-if="state.activeId !== 'local'" class="px-3 py-2 text-xs opacity-60">
        {{ t("output.remoteHint") }}
      </p>
    </div>
  </SPopover>
</template>

<style scoped>
.output-target {
  background: transparent;
  border: 0;
  appearance: none;
  font: inherit;
}
.output-target:hover:not(:disabled) {
  background: color-mix(in srgb, currentColor 6%, transparent);
}
.output-target:focus-visible {
  outline: 2px solid currentColor;
  outline-offset: -2px;
}
</style>
