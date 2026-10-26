<script setup lang="ts">
/**
 * Puente al loading global de la plantilla (window.siahPageLoading).
 * El overlay visual vive una sola vez en el host: SiahPageLoading.vue.
 */
import { onUnmounted, watch } from "vue";

const props = withDefaults(
  defineProps<{
    show: boolean;
    label?: string;
  }>(),
  { label: "Cargando datos médicos" },
);

type PageLoadingApi = {
  start: (label?: string) => void;
  stop: () => void;
};

let held = false;

function api(): PageLoadingApi | null {
  if (typeof window === "undefined") return null;
  const loading = (window as Window & { siahPageLoading?: PageLoadingApi }).siahPageLoading;
  return loading ?? null;
}

function sync(visible: boolean) {
  const loading = api();
  if (!loading) return;
  if (visible && !held) {
    loading.start(props.label);
    held = true;
    return;
  }
  if (!visible && held) {
    loading.stop();
    held = false;
  }
}

watch(
  () => props.show,
  (visible) => {
    sync(visible);
  },
  { immediate: true },
);

onUnmounted(() => {
  if (!held) return;
  api()?.stop();
  held = false;
});
</script>

<template>
  <span hidden aria-hidden="true" />
</template>
