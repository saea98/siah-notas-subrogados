<script setup lang="ts">
import NotasSubrogadosWidget from "../NotasSubrogadosWidget.vue";
defineOptions({ inheritAttrs: false });
</script>
<template><NotasSubrogadosWidget v-bind="$attrs" initial-tab="signos" :visible-tabs="['signos', 'consulta']" /></template>
