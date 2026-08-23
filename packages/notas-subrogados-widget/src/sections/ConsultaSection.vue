<script setup lang="ts">
import NotasSubrogadosWidget from "../NotasSubrogadosWidget.vue";
defineOptions({ inheritAttrs: false });
</script>
<template><NotasSubrogadosWidget v-bind="$attrs" initial-tab="consulta" :visible-tabs="['consulta', 'signos']" /></template>
