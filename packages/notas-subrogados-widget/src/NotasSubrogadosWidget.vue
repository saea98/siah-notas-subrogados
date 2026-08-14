<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from "vue";

const props = withDefaults(
  defineProps<{
    /** Base URL del FastAPI Subrogados (ej. http://127.0.0.1:8002) */
    apiBase: string;
    /** Prefijo opcional de rutas (proxy Laravel) */
    apiPrefix?: string;
    session: { usuario: string; password: string; unitrab: string };
  }>(),
  { apiPrefix: "" },
);

const emit = defineEmits<{
  openExpediente: [payload: { ficha: string; codigo: string; hosi_folio?: number }];
}>();

const loading = ref(false);
const error = ref("");
const okMsg = ref("");
const rows = ref<Record<string, unknown>[]>([]);
const fecha = ref(new Date().toISOString().slice(0, 10));
const tab = ref<"agenda" | "asignar" | "consulta" | "signos">("agenda");

const especialidades = ref<{ esps_espserv: number; espc_descrip: string }[]>([]);
const medicos = ref<{ medc_ficha: string; medc_codigo: string; medc_nombre: string; esps_espserv: number }[]>([]);
const horas = ref<{ hora: number; label: string }[]>([]);

const asignar = reactive({
  ficha: "100001",
  codigo: "00",
  esps_espserv: 101,
  medc_ficha: "900002",
  medc_codigo: "00",
  fecha: new Date().toISOString().slice(0, 10),
  hora: 900,
});

const consulta = reactive({
  hosi_folio: 0,
  sintomas: "",
  objetivo: "",
  analisis: "",
  plan: "",
  diai_clacie1: "",
});

const signos = reactive({
  hosi_folio: 0,
  pulso: "",
  respiracion: "",
  tension_sis: "",
  tension_dia: "",
  temperatura: "",
  peso: "",
  estatura: "",
  abdominal: "",
});

/** Contexto de la cita en uso (acomodo tipo siah-web). */
const citaCtx = reactive({
  hosi_folio: 0,
  ficha: "",
  codigo: "",
  paciente: "",
  especialidad: "",
  medico: "",
});

const prefix = computed(() => {
  const p = (props.apiPrefix || "").trim();
  if (!p) return "";
  return p.startsWith("/") ? p.replace(/\/+$/, "") : `/${p.replace(/\/+$/, "")}`;
});

async function post<T>(path: string, body: unknown): Promise<T> {
  const base = props.apiBase.replace(/\/+$/, "");
  const url = `${base}${prefix.value}${path.startsWith("/") ? path : `/${path}`}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(typeof data.detail === "string" ? data.detail : JSON.stringify(data.detail || data));
  return data as T;
}

async function load() {
  loading.value = true;
  error.value = "";
  try {
    const data = await post<{ rows: Record<string, unknown>[] }>("/sub/atmed/citas", {
      ...props.session,
      fecha: fecha.value,
    });
    rows.value = data.rows || [];
  } catch (e) {
    error.value = e instanceof Error ? e.message : "Error cargando citas";
  } finally {
    loading.value = false;
  }
}

async function loadCatalogos() {
  try {
    const [esp, med] = await Promise.all([
      post<{ rows: Record<string, unknown>[] }>("/sub/atmed/especialidades", props.session),
      post<{ rows: Record<string, unknown>[] }>("/sub/atmed/medicos", {
        ...props.session,
        esps_espserv: asignar.esps_espserv,
      }),
    ]);
    especialidades.value = (esp.rows || []).map((r) => ({
      esps_espserv: Number(r.esps_espserv),
      espc_descrip: String(r.espc_descrip || ""),
    }));
    medicos.value = (med.rows || []).map((r) => ({
      medc_ficha: String(r.medc_ficha || ""),
      medc_codigo: String(r.medc_codigo || "00"),
      medc_nombre: String(r.medc_nombre || ""),
      esps_espserv: Number(r.esps_espserv),
    }));
    if (medicos.value.length && !medicos.value.find((m) => m.medc_ficha === asignar.medc_ficha)) {
      asignar.medc_ficha = medicos.value[0].medc_ficha;
      asignar.medc_codigo = medicos.value[0].medc_codigo;
    }
    await loadHoras();
  } catch (e) {
    error.value = e instanceof Error ? e.message : "Error catálogos";
  }
}

async function loadHoras() {
  const data = await post<{ rows: { hora: number; label: string }[] }>("/sub/atmed/horas", {
    ...props.session,
    medc_ficha: asignar.medc_ficha,
    medc_codigo: asignar.medc_codigo,
    fecha: asignar.fecha,
  });
  horas.value = data.rows || [];
  if (horas.value.length && !horas.value.find((h) => h.hora === asignar.hora)) {
    asignar.hora = horas.value[0].hora;
  }
}

async function llegada(folio: number) {
  loading.value = true;
  try {
    await post("/sub/atmed/llegada", { ...props.session, hosi_folio: folio });
    okMsg.value = "Llegada registrada";
    await load();
  } catch (e) {
    error.value = e instanceof Error ? e.message : "Error registrando llegada";
  } finally {
    loading.value = false;
  }
}

async function doAsignar() {
  loading.value = true;
  error.value = "";
  okMsg.value = "";
  try {
    const res = await post<{ mensaje: string; record?: { hosi_folio: number } }>("/sub/atmed/asignar", {
      ...props.session,
      ...asignar,
    });
    okMsg.value = res.mensaje + (res.record ? ` · folio ${res.record.hosi_folio}` : "");
    fecha.value = asignar.fecha;
    tab.value = "agenda";
    await load();
    await loadHoras();
  } catch (e) {
    error.value = e instanceof Error ? e.message : "Error al asignar";
  } finally {
    loading.value = false;
  }
}

function selectCita(row: Record<string, unknown>) {
  const folio = Number(row.hosi_folio);
  consulta.hosi_folio = folio;
  signos.hosi_folio = folio;
  citaCtx.hosi_folio = folio;
  citaCtx.ficha = String(row.derc_ficha || "");
  citaCtx.codigo = String(row.derc_codigo || "00");
  citaCtx.paciente = String(row.paciente || "");
  citaCtx.especialidad = String(row.especialidad || "");
  citaCtx.medico = String(row.medico || "");
}

async function doConsulta() {
  if (!consulta.hosi_folio) {
    error.value = "Seleccione una cita (folio)";
    return;
  }
  loading.value = true;
  error.value = "";
  try {
    const res = await post<{ mensaje: string }>("/sub/atmed/consulta", { ...props.session, ...consulta });
    okMsg.value = res.mensaje;
    await load();
  } catch (e) {
    error.value = e instanceof Error ? e.message : "Error al grabar consulta";
  } finally {
    loading.value = false;
  }
}

async function doSignos() {
  if (!signos.hosi_folio) {
    error.value = "Seleccione una cita (folio)";
    return;
  }
  loading.value = true;
  error.value = "";
  try {
    const res = await post<{ mensaje: string }>("/sub/atmed/signos", { ...props.session, ...signos });
    okMsg.value = res.mensaje;
  } catch (e) {
    error.value = e instanceof Error ? e.message : "Error al grabar signos";
  } finally {
    loading.value = false;
  }
}

watch(
  () => [asignar.esps_espserv, asignar.medc_ficha, asignar.fecha],
  () => {
    if (tab.value === "asignar") loadCatalogos();
  },
);

onMounted(async () => {
  await load();
  await loadCatalogos();
});
</script>

<template>
  <div class="siah-atmed-widget space-y-4">
    <div class="flex flex-wrap gap-2">
      <UButton
        v-for="t in [
          { id: 'agenda', label: 'Agenda' },
          { id: 'asignar', label: 'Asignar cita' },
          { id: 'consulta', label: 'Consulta' },
          { id: 'signos', label: 'Signos' },
        ]"
        :key="t.id"
        size="sm"
        :variant="tab === t.id ? 'solid' : 'soft'"
        :label="t.label"
        @click="tab = t.id as typeof tab"
      />
    </div>

    <UAlert v-if="error" color="error" variant="subtle" :title="error" />
    <UAlert v-if="okMsg" color="success" variant="subtle" :title="okMsg" />

    <div v-if="tab === 'agenda'" class="space-y-3">
      <div class="flex flex-wrap items-end gap-2">
        <UFormField label="Fecha">
          <UInput v-model="fecha" type="date" @change="load" />
        </UFormField>
        <UButton icon="i-lucide-refresh-cw" label="Actualizar" :loading="loading" @click="load" />
      </div>
      <UTable
        :data="rows"
        :loading="loading"
        :columns="[
          { accessorKey: 'citn_hrcita', header: 'Hora' },
          { accessorKey: 'paciente', header: 'Paciente' },
          { accessorKey: 'derc_ficha', header: 'Ficha' },
          { accessorKey: 'especialidad', header: 'Esp.' },
          { accessorKey: 'medico', header: 'Médico' },
          { accessorKey: 'cits_estatus', header: 'Est.' },
          { accessorKey: 'cits_hrllegada', header: 'Llegada' },
          { id: 'actions', header: '' },
        ]"
      >
        <template #actions-cell="{ row }">
          <div class="flex gap-1 justify-end">
            <UButton
              size="xs"
              variant="soft"
              label="Llegó"
              :disabled="Number(row.original.cits_estatus) >= 2"
              @click="llegada(Number(row.original.hosi_folio))"
            />
            <UButton
              size="xs"
              variant="outline"
              label="Usar"
              @click="
                selectCita(row.original);
                tab = 'consulta';
              "
            />
            <UButton
              size="xs"
              color="neutral"
              variant="ghost"
              icon="i-lucide-folder-open"
              @click="
                emit('openExpediente', {
                  ficha: String(row.original.derc_ficha || ''),
                  codigo: String(row.original.derc_codigo || '00'),
                  hosi_folio: Number(row.original.hosi_folio),
                })
              "
            />
          </div>
        </template>
      </UTable>
      <p class="text-xs text-muted">{{ rows.length }} cita(s) · unidad {{ session.unitrab }}</p>
    </div>

    <div v-else-if="tab === 'asignar'" class="grid gap-3 sm:grid-cols-3 border border-default rounded-lg p-4">
      <UFormField label="Ficha"><UInput v-model="asignar.ficha" /></UFormField>
      <UFormField label="Código"><UInput v-model="asignar.codigo" /></UFormField>
      <UFormField label="Fecha"><UInput v-model="asignar.fecha" type="date" /></UFormField>
      <UFormField label="Especialidad">
        <select
          v-model.number="asignar.esps_espserv"
          class="w-full rounded-md border border-default bg-default px-3 py-2 text-sm"
          @change="loadCatalogos"
        >
          <option v-for="e in especialidades" :key="e.esps_espserv" :value="e.esps_espserv">
            {{ e.esps_espserv }} — {{ e.espc_descrip }}
          </option>
        </select>
      </UFormField>
      <UFormField label="Médico">
        <select
          v-model="asignar.medc_ficha"
          class="w-full rounded-md border border-default bg-default px-3 py-2 text-sm"
          @change="
            asignar.medc_codigo =
              medicos.find((m) => m.medc_ficha === asignar.medc_ficha)?.medc_codigo || '00';
            loadHoras();
          "
        >
          <option v-for="m in medicos" :key="m.medc_ficha + m.esps_espserv" :value="m.medc_ficha">
            {{ m.medc_nombre }} ({{ m.medc_ficha }})
          </option>
        </select>
      </UFormField>
      <UFormField label="Hora disponible">
        <select
          v-model.number="asignar.hora"
          class="w-full rounded-md border border-default bg-default px-3 py-2 text-sm"
        >
          <option v-for="h in horas" :key="h.hora" :value="h.hora">{{ h.label }}</option>
        </select>
      </UFormField>
      <div class="sm:col-span-3">
        <UButton icon="i-lucide-calendar-plus" label="Asignar cita" :loading="loading" @click="doAsignar" />
      </div>
    </div>

    <div v-else-if="tab === 'consulta'" class="space-y-3">
      <div
        v-if="citaCtx.hosi_folio"
        class="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-primary/10 ring ring-primary/20 px-4 py-3"
      >
        <div class="min-w-0">
          <p class="text-[11px] font-semibold uppercase tracking-wide text-primary">Consulta en curso</p>
          <p class="text-sm font-bold text-highlighted truncate">
            {{ citaCtx.paciente || "Paciente" }}
          </p>
          <p class="text-xs text-muted">
            Folio {{ citaCtx.hosi_folio }} · Ficha {{ citaCtx.ficha }}-{{ citaCtx.codigo }}
            <span v-if="citaCtx.especialidad"> · {{ citaCtx.especialidad }}</span>
            <span v-if="citaCtx.medico"> · {{ citaCtx.medico }}</span>
          </p>
        </div>
        <UButton size="sm" color="neutral" variant="soft" label="Ir a signos" @click="tab = 'signos'" />
      </div>

      <!-- Acomodo siah-web NotasHospModal: cabecera 2 cols + SOAP apilado full-width -->
      <section class="space-y-3 rounded-lg border border-default bg-default p-4">
        <h3 class="text-sm font-semibold text-highlighted">Nota SOAP</h3>
        <div class="grid gap-3 sm:grid-cols-2">
          <UFormField label="Folio cita">
            <UInput v-model.number="consulta.hosi_folio" type="number" class="w-full" />
          </UFormField>
          <UFormField label="CIE-10 motivo de la consulta">
            <UInput v-model="consulta.diai_clacie1" class="w-full" placeholder="Ej. R51X" />
          </UFormField>
          <UFormField label="Síntomas" class="sm:col-span-2">
            <UTextarea v-model="consulta.sintomas" :rows="3" class="w-full" />
          </UFormField>
          <UFormField label="Objetivo" class="sm:col-span-2">
            <UTextarea v-model="consulta.objetivo" :rows="3" class="w-full" />
          </UFormField>
          <UFormField label="Análisis" class="sm:col-span-2">
            <UTextarea v-model="consulta.analisis" :rows="3" class="w-full" />
          </UFormField>
          <UFormField label="Plan" class="sm:col-span-2">
            <UTextarea v-model="consulta.plan" :rows="3" class="w-full" />
          </UFormField>
        </div>
        <div class="flex justify-end gap-2 pt-1">
          <UButton
            color="neutral"
            variant="ghost"
            label="Limpiar"
            @click="
              consulta.sintomas = '';
              consulta.objetivo = '';
              consulta.analisis = '';
              consulta.plan = '';
              consulta.diai_clacie1 = '';
            "
          />
          <UButton icon="i-lucide-save" label="Grabar consulta" :loading="loading" @click="doConsulta" />
        </div>
      </section>
    </div>

    <div v-else class="space-y-3">
      <div
        v-if="citaCtx.hosi_folio"
        class="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-primary/10 ring ring-primary/20 px-4 py-3"
      >
        <div class="min-w-0">
          <p class="text-[11px] font-semibold uppercase tracking-wide text-primary">Signos vitales</p>
          <p class="text-sm font-bold text-highlighted truncate">
            {{ citaCtx.paciente || "Paciente" }}
          </p>
          <p class="text-xs text-muted">
            Folio {{ citaCtx.hosi_folio }} · Ficha {{ citaCtx.ficha }}-{{ citaCtx.codigo }}
          </p>
        </div>
        <UButton size="sm" color="neutral" variant="soft" label="Volver a consulta" @click="tab = 'consulta'" />
      </div>

      <!-- Acomodo siah-web: sección + grid 4 cols compacto -->
      <section class="space-y-3 rounded-lg border border-default bg-default p-4">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <h3 class="text-sm font-semibold text-highlighted">Captura de signos</h3>
          <UFormField label="Folio cita" class="w-40">
            <UInput v-model.number="signos.hosi_folio" type="number" class="w-full" />
          </UFormField>
        </div>
        <div class="grid gap-3 sm:grid-cols-4">
          <UFormField label="Pulso">
            <UInput v-model="signos.pulso" class="w-full" />
          </UFormField>
          <UFormField label="Respiración">
            <UInput v-model="signos.respiracion" class="w-full" />
          </UFormField>
          <UFormField label="TA sistólica">
            <UInput v-model="signos.tension_sis" class="w-full" />
          </UFormField>
          <UFormField label="TA diastólica">
            <UInput v-model="signos.tension_dia" class="w-full" />
          </UFormField>
          <UFormField label="Temperatura °C">
            <UInput v-model="signos.temperatura" class="w-full" />
          </UFormField>
          <UFormField label="Peso kg">
            <UInput v-model="signos.peso" class="w-full" />
          </UFormField>
          <UFormField label="Estatura cm">
            <UInput v-model="signos.estatura" class="w-full" />
          </UFormField>
          <UFormField label="Per. abdominal cm">
            <UInput v-model="signos.abdominal" class="w-full" />
          </UFormField>
        </div>
        <div class="flex justify-end gap-2 pt-1">
          <UButton
            color="neutral"
            variant="ghost"
            label="Limpiar"
            @click="
              signos.pulso = '';
              signos.respiracion = '';
              signos.tension_sis = '';
              signos.tension_dia = '';
              signos.temperatura = '';
              signos.peso = '';
              signos.estatura = '';
              signos.abdominal = '';
            "
          />
          <UButton icon="i-lucide-activity" label="Grabar signos" :loading="loading" @click="doSignos" />
        </div>
      </section>
    </div>
  </div>
</template>
