<script setup lang="ts">
import NotasSubrogadosWidget from "../NotasSubrogadosWidget.vue";
defineOptions({ inheritAttrs: false });
</script>
<template><NotasSubrogadosWidget v-bind="$attrs" initial-tab="asignar" :visible-tabs="['asignar']" /></template>
