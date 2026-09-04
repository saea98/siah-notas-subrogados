<script setup lang="ts">
defineProps<{ title: string }>();
</script>

<template>
  <UCard
    :ui="{
      root: 'overflow-hidden w-full',
      header: 'px-3 py-2 bg-elevated border-b border-default',
      body: 'p-3 w-full',
    }"
  >
    <template #header>
      <h3 class="text-xs font-bold uppercase tracking-wide text-highlighted">{{ title }}</h3>
    </template>
    <slot />
  </UCard>
</template>
