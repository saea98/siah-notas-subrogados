<script setup lang="ts">
/**
 * Datepicker del widget (paridad con AppDatePicker del host).
 * No usar <input type="date"> — regla UI del sistema.
 */
import { computed, ref } from "vue";
import {
  getLocalTimeZone,
  parseDate,
  toCalendarDate,
  today,
} from "@internationalized/date";

const props = withDefaults(
  defineProps<{
    modelValue?: string | null;
    placeholder?: string;
    disabled?: boolean;
    clearable?: boolean;
    min?: string | null;
    max?: string | null;
    size?: string;
  }>(),
  {
    modelValue: null,
    placeholder: "dd/mm/aaaa",
    disabled: false,
    clearable: true,
    min: null,
    max: null,
    size: "md",
  },
);

const emit = defineEmits<{ "update:modelValue": [value: string | null] }>();

const open = ref(false);

function isoToCalendarDate(iso: string | null | undefined) {
  if (!iso) return null;
  try {
    return parseDate(String(iso).slice(0, 10));
  } catch {
    return null;
  }
}

function calendarDateToIso(value: unknown): string | null {
  if (!value) return null;
  try {
    return toCalendarDate(value as Parameters<typeof toCalendarDate>[0]).toString();
  } catch {
    return null;
  }
}

function formatDisplayDate(iso: string | null | undefined): string {
  const value = isoToCalendarDate(iso);
  if (!value) return "";
  return new Intl.DateTimeFormat("es-MX", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(value.toDate(getLocalTimeZone()));
}

const calendarValue = computed({
  get: () => isoToCalendarDate(props.modelValue),
  set: (value) => {
    emit("update:modelValue", calendarDateToIso(value));
    open.value = false;
  },
});

const displayValue = computed(() => formatDisplayDate(props.modelValue));
const minValue = computed(() => isoToCalendarDate(props.min));
const maxValue = computed(() => isoToCalendarDate(props.max));

function clear(event?: Event) {
  event?.stopPropagation();
  emit("update:modelValue", null);
}

function goToday() {
  calendarValue.value = today(getLocalTimeZone());
}
</script>

<template>
  <UPopover
    v-model:open="open"
    :content="{ side: 'bottom', align: 'start' }"
    :disabled="disabled"
  >
    <UButton
      color="neutral"
      variant="outline"
      :disabled="disabled"
      :size="size"
      icon="i-lucide-calendar"
      class="w-full justify-start font-normal min-w-[9.5rem]"
      :class="!displayValue ? 'text-muted' : ''"
      aria-label="Seleccionar fecha"
    >
      <span class="flex-1 text-left">{{ displayValue || placeholder }}</span>
      <UIcon
        v-if="clearable && modelValue && !disabled"
        name="i-lucide-x"
        class="size-4 shrink-0 opacity-60 hover:opacity-100"
        @click="clear"
      />
    </UButton>

    <template #content>
      <div class="p-2">
        <UCalendar
          v-model="calendarValue"
          :min-value="minValue"
          :max-value="maxValue"
        />
        <div class="flex justify-between border-t border-default px-1 pt-2">
          <UButton size="xs" color="neutral" variant="ghost" @click="goToday">Hoy</UButton>
          <UButton
            v-if="clearable"
            size="xs"
            color="neutral"
            variant="ghost"
            @click="clear"
          >
            Limpiar
          </UButton>
        </div>
      </div>
    </template>
  </UPopover>
</template>
