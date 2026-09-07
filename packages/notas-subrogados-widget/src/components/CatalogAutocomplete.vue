<script setup lang="ts">
import { ref, watch } from "vue";

type SessionAuth = { usuario: string; password: string; unitrab: string };
type Hit = { clave: string; descripcion: string; [k: string]: unknown };

const props = withDefaults(
  defineProps<{
    apiBase: string;
    apiPrefix?: string;
    session: SessionAuth;
    tipo: "cie10" | "procedimientos" | "medicamentos" | "proveedores" | "servicios";
    modelValue?: string;
    placeholder?: string;
    label?: string;
    minChars?: number;
    disabled?: boolean;
  }>(),
  {
    apiPrefix: "",
    modelValue: "",
    placeholder: "Escriba ≥2 caracteres…",
    label: "",
    minChars: 2,
    disabled: false,
  },
);

const emit = defineEmits<{
  "update:modelValue": [string];
  select: [Hit];
}>();

const q = ref(props.modelValue || "");
const open = ref(false);
const loading = ref(false);
const error = ref("");
const items = ref<Hit[]>([]);
let timer: ReturnType<typeof setTimeout> | undefined;

watch(
  () => props.modelValue,
  (v) => {
    if (v !== q.value) q.value = v || "";
  },
);

function joinUrl(path: string) {
  const b = props.apiBase.replace(/\/+$/, "");
  const pfx = props.apiPrefix
    ? props.apiPrefix.startsWith("/")
      ? props.apiPrefix.replace(/\/+$/, "")
      : `/${props.apiPrefix.replace(/\/+$/, "")}`
    : "";
  return `${b}${pfx}${path.startsWith("/") ? path : `/${path}`}`;
}

async function search(term: string) {
  const t = term.trim();
  if (t.length < (props.minChars || 2)) {
    items.value = [];
    error.value = t ? `Escriba al menos ${props.minChars} caracteres` : "";
    return;
  }
  loading.value = true;
  error.value = "";
  try {
    const res = await fetch(joinUrl("/sub/catalogos/buscar"), {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ ...props.session, tipo: props.tipo, q: t, limit: 40 }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(typeof data.detail === "string" ? data.detail : "Error catálogo");
    }
    items.value = (data.rows || []).map((r: Record<string, unknown>) => ({
      ...r,
      clave: String(r.clave || ""),
      descripcion: String(r.descripcion || r.medicamento || ""),
    }));
    if (!items.value.length) error.value = "Sin coincidencias";
  } catch (e) {
    items.value = [];
    error.value = e instanceof Error ? e.message : "Error";
  } finally {
    loading.value = false;
  }
}

function onInput(v: string) {
  if (props.disabled) return;
  q.value = v;
  emit("update:modelValue", v);
  open.value = true;
  clearTimeout(timer);
  timer = setTimeout(() => search(v), 280);
}

function pick(item: Hit) {
  const label = [item.clave, item.descripcion].filter(Boolean).join(" — ");
  q.value = label;
  emit("update:modelValue", label);
  emit("select", item);
  open.value = false;
}

function onBlur() {
  setTimeout(() => {
    open.value = false;
  }, 180);
}
</script>

<template>
  <div class="relative w-full">
    <UFormField v-if="label" :label="label" class="w-full">
      <UInput
        :model-value="q"
        size="sm"
        icon="i-lucide-search"
        :loading="loading"
        :placeholder="placeholder"
        :disabled="disabled"
        autocomplete="off"
        @update:model-value="onInput(String($event ?? ''))"
        @focus="open = true"
        @blur="onBlur"
      />
    </UFormField>
    <UInput
      v-else
      :model-value="q"
      size="sm"
      icon="i-lucide-search"
      :loading="loading"
      :placeholder="placeholder"
      :disabled="disabled"
      autocomplete="off"
      @update:model-value="onInput(String($event ?? ''))"
      @focus="open = true"
      @blur="onBlur"
    />
    <div
      v-if="!disabled && open && (items.length || error || loading)"
      class="absolute z-50 mt-1 max-h-60 w-full overflow-y-auto rounded-lg border border-default bg-default shadow-lg"
    >
      <button
        v-for="item in items"
        :key="item.clave + item.descripcion"
        type="button"
        class="block w-full px-2 py-1.5 text-left text-xs hover:bg-elevated"
        @mousedown.prevent="pick(item)"
      >
        <span class="font-semibold">{{ item.clave }}</span>
        <span v-if="item.descripcion" class="text-muted"> — {{ item.descripcion }}</span>
      </button>
      <p v-if="loading && !items.length" class="px-2 py-2 text-xs text-muted m-0">Buscando…</p>
      <p v-else-if="error" class="px-2 py-2 text-xs text-muted m-0">{{ error }}</p>
    </div>
  </div>
</template>
