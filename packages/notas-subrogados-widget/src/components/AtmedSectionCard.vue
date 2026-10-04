<script setup lang="ts">
defineProps<{
  title: string;
  /** Número de sección estilo prototipo (opcional). */
  number?: string | number;
}>();
</script>

<template>
  <UCard
    :ui="{
      root: 'overflow-visible w-full rounded-[7px] border border-[var(--siah-line,#dfe6ef)] bg-white shadow-none',
      header: 'px-5 py-4 bg-[#fafcfd] border-b border-[var(--siah-line,#dfe6ef)]',
      body: 'p-5 w-full overflow-visible',
    }"
  >
    <template #header>
      <div class="flex items-center justify-between gap-3">
        <h3 class="m-0 flex items-center gap-2.5 text-[13px] font-bold uppercase tracking-wide text-[var(--siah-green,#006b44)]">
          <span v-if="number != null && number !== ''" class="siah-number">{{ number }}</span>
          {{ title }}
        </h3>
        <div v-if="$slots.actions" class="shrink-0">
          <slot name="actions" />
        </div>
      </div>
    </template>
    <slot />
  </UCard>
</template>
