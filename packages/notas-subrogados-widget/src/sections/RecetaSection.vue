<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";

const props = defineProps<{
  apiBase: string;
  apiPrefix?: string;
  fetchFn?: typeof fetch;
  readOnly?: boolean;
  canPrescribe?: boolean;
  hosiFolio: number;
  ficha?: string;
  codigo?: string;
}>();

const emit = defineEmits<{ saved: [record: Record<string, unknown>] }>();
const loading = ref(false);
const searching = ref(false);
const error = ref("");
const ok = ref("");
const articles = ref<{ clave_siah: number; descripcion: string; costo?: number }[]>([]);
const form = reactive({ clave_siah: null as number | null, dosis: "", via: "ORAL", periodo: 1, dias: 1, cantidad: 1, indicaciones: "", surtir_subrogados: true });
const canEmit = computed(() => !props.readOnly && props.canPrescribe !== false && props.hosiFolio > 0);
const prefix = computed(() => {
  const value = (props.apiPrefix || "").trim();
  return value ? (value.startsWith("/") ? value.replace(/\/+$/, "") : `/${value.replace(/\/+$/, "")}`) : "";
});

async function post<T>(path: string, body: unknown): Promise<T> {
  const response = await (props.fetchFn ?? fetch)(`${props.apiBase.replace(/\/+$/, "")}${prefix.value}${path}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const validation = data?.errors && typeof data.errors === "object" ? Object.values(data.errors).flat().find((value) => typeof value === "string") : null;
    throw new Error(data?.detail || data?.message || validation || "No fue posible emitir la receta.");
  }
  return data as T;
}

async function search() {
  if (!canEmit.value) return;
  searching.value = true; error.value = "";
  try {
    const data = await post<{ rows?: Record<string, unknown>[] }>("/sub/atmed/receta/articulos", { q: "", limit: 50 });
    articles.value = (data.rows || []).map((item) => ({ clave_siah: Number(item.clave_siah), descripcion: String(item.descripcion || ""), costo: Number(item.costo || 0) }));
  } catch (cause) { error.value = cause instanceof Error ? cause.message : "No fue posible cargar medicamentos"; }
  finally { searching.value = false; }
}

async function save() {
  if (!canEmit.value || !form.clave_siah) return;
  loading.value = true; error.value = ""; ok.value = "";
  try {
    const data = await post<{ mensaje?: string; record?: Record<string, unknown> }>("/sub/atmed/receta", { ...form, hosi_folio: props.hosiFolio, idempotency_key: crypto.randomUUID() });
    ok.value = data.mensaje || "Receta emitida";
    emit("saved", data.record || {});
  } catch (cause) { error.value = cause instanceof Error ? cause.message : "No fue posible emitir la receta"; }
  finally { loading.value = false; }
}

watch(() => props.hosiFolio, () => { error.value = ""; ok.value = ""; form.clave_siah = null; });
watch(canEmit, (value) => { if (value && !articles.value.length) void search(); }, { immediate: true });
</script>

<template>
  <div class="space-y-4">
    <div v-if="!hosiFolio" class="rounded-xl bg-warning/10 px-4 py-3 text-sm text-warning-700">Seleccione una cita desde Agenda para emitir una receta.</div>
    <div v-else-if="readOnly || canPrescribe === false" class="rounded-xl bg-neutral/10 px-4 py-3 text-sm">No cuenta con permiso para emitir recetas en esta consulta.</div>
    <fieldset v-else :disabled="loading" class="space-y-4">
      <div class="rounded-xl bg-primary/10 ring ring-primary/20 px-4 py-3 text-sm text-highlighted">Folio {{ hosiFolio }} · Ficha {{ ficha || '—' }}-{{ codigo || '00' }}. Guarde primero la nota SOAP.</div>
      <div v-if="error" class="rounded-lg bg-error/10 px-3 py-2 text-sm text-error">{{ error }}</div>
      <div v-if="ok" class="rounded-lg bg-success/10 px-3 py-2 text-sm text-success">{{ ok }}</div>
      <div class="grid gap-3 sm:grid-cols-2">
        <UFormField label="Medicamento institucional" class="sm:col-span-2"><USelect v-model="form.clave_siah" :items="articles.map(a => ({ label: `${a.clave_siah} · ${a.descripcion}`, value: a.clave_siah }))" placeholder="Seleccione un medicamento" class="w-full" :loading="searching" /></UFormField>
        <UFormField label="Dosis"><UInput v-model="form.dosis" class="w-full" placeholder="Ej. 500 mg" /></UFormField>
        <UFormField label="Vía"><USelect v-model="form.via" :items="['ORAL', 'INTRAMUSCULAR', 'INTRAVENOSA', 'TÓPICA', 'SUBLINGUAL']" class="w-full" /></UFormField>
        <UFormField label="Cada cuánto"><UInput v-model.number="form.periodo" type="number" min="1" class="w-full" /></UFormField>
        <UFormField label="Días de tratamiento"><UInput v-model.number="form.dias" type="number" min="1" class="w-full" /></UFormField>
        <UFormField label="Cantidad"><UInput v-model.number="form.cantidad" type="number" min="1" class="w-full" /></UFormField>
        <UFormField label="Surtir en farmacia subrogada"><USwitch v-model="form.surtir_subrogados" /></UFormField>
        <UFormField label="Indicaciones" class="sm:col-span-2"><UTextarea v-model="form.indicaciones" :rows="3" class="w-full" /></UFormField>
      </div>
      <div class="flex justify-end"><UButton icon="i-lucide-prescription" label="Emitir receta" :loading="loading" :disabled="!form.clave_siah" @click="save" /></div>
    </fieldset>
  </div>
</template>
