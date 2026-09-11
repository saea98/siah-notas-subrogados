<script setup lang="ts">
import { computed, ref, watch } from "vue";

type SessionAuth = { usuario: string; password: string; unitrab: string };

type Categoria = "LAB" | "BACT" | "IMG" | "INTERC";
type EstatusSol = "ELABORADA" | "REALIZADO" | "CANCELADA";

type CatalogItem = {
  clave: string | number;
  descripcion: string;
  unidad: string;
  indicaciones: string;
};

type SolRow = {
  id: string;
  tipo: Categoria;
  servicio: string;
  descripcion: string;
  clave: string;
  estatus: EstatusSol;
};

const CATEGORIAS: { value: Categoria; label: string; seccion: string }[] = [
  { value: "LAB", label: "LABORATORIO CLINICO", seccion: "ANALISISCLINICOS" },
  { value: "BACT", label: "BACTERIOLOGIA", seccion: "BACTERIOLOGIA" },
  { value: "IMG", label: "IMAGENOLOGIA", seccion: "IMAGENOLOGIARISPACS" },
  { value: "INTERC", label: "INTERCONSULTA", seccion: "INTERCONSULTA" },
];

const open = defineModel<boolean>("open", { required: true });

const props = withDefaults(
  defineProps<{
    apiBase: string;
    apiPrefix?: string;
    session: SessionAuth;
    folio: number;
    pacienteLine: string;
    diagnostico?: string;
    /** Solo consulta: no alta/cancelación (altas van por forma 11-5). */
    readOnly?: boolean;
  }>(),
  { apiPrefix: "", diagnostico: "", readOnly: true },
);

const emit = defineEmits<{ close: [] }>();

const loading = ref(false);
const searching = ref(false);
const error = ref("");
const okMsg = ref("");
const categoria = ref<Categoria>("LAB");
const q = ref("");
const datos = ref("");
const unidadLabel = ref("");
const catalogo = ref<CatalogItem[]>([]);
const selectedClave = ref<string | number | null>(null);
const registradas = ref<SolRow[]>([]);
const selectedRegId = ref<string | null>(null);
const printIds = ref<string[]>([]);
const filtroEstatus = ref<EstatusSol>("ELABORADA");
let searchTimer: ReturnType<typeof setTimeout> | undefined;

const catMeta = computed(
  () => CATEGORIAS.find((c) => c.value === categoria.value) || CATEGORIAS[0],
);

const selectedItem = computed(
  () => catalogo.value.find((i) => String(i.clave) === String(selectedClave.value)) || null,
);

const registradasFiltradas = computed(() =>
  registradas.value.filter((r) => r.estatus === filtroEstatus.value),
);

function joinUrl(path: string) {
  const b = props.apiBase.replace(/\/+$/, "");
  const pfx = props.apiPrefix
    ? props.apiPrefix.startsWith("/")
      ? props.apiPrefix.replace(/\/+$/, "")
      : `/${props.apiPrefix.replace(/\/+$/, "")}`
    : "";
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${b}${pfx}${p}`;
}

function asRows(payload: unknown): Record<string, unknown>[] {
  if (Array.isArray(payload)) return payload as Record<string, unknown>[];
  if (payload && typeof payload === "object") {
    const o = payload as { data?: unknown; rows?: unknown };
    if (Array.isArray(o.data)) return o.data as Record<string, unknown>[];
    if (Array.isArray(o.rows)) return o.rows as Record<string, unknown>[];
  }
  return [];
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(joinUrl(path), {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = (data as { detail?: unknown })?.detail;
    throw new Error(typeof detail === "string" ? detail : "Error API");
  }
  return data as T;
}

function auth() {
  return {
    ...props.session,
    folio: props.folio,
    idUnidadMedica: props.session.unitrab,
  };
}

function mapCatalog(row: Record<string, unknown>): CatalogItem | null {
  const clave = row.clave ?? row.cve_estudio ?? row.cveEstudio ?? "";
  const descripcion = String(
    row.descripcion || row.desc_estudio || row.estudio || row.espc_descrip || "",
  ).trim();
  if (!clave && !descripcion) return null;
  return {
    clave,
    descripcion: descripcion || String(clave),
    unidad: String(unidadLabel.value || row.unidad || row.abrev_estudio || "—").trim() || "—",
    indicaciones: String(row.indicaciones || row.dtipo_estudio || "").trim(),
  };
}

async function loadUnidad() {
  try {
    const res = await post<{ record?: { cve_umedca?: string; nombre?: string } }>("/sub/unidad", {
      ...props.session,
    });
    unidadLabel.value = String(res.record?.cve_umedca || res.record?.nombre || "").trim();
  } catch {
    unidadLabel.value = String(props.session.unitrab || "");
  }
}

async function buscarCatalogo(term = q.value) {
  const t = term.trim();
  searching.value = true;
  error.value = "";
  try {
    let path = "/ece/nota/ce/estudios-lab";
    const body: Record<string, unknown> = { ...props.session, q: t, limit: t ? 40 : 30 };
    if (categoria.value === "BACT") path = "/ece/nota/ce/estudios-bact";
    if (categoria.value === "IMG") path = "/ece/nota/ce/estudios-imagen";
    if (categoria.value === "INTERC") path = "/ece/nota/ce/especialidades";
    const data = await post<unknown>(path, body);
    catalogo.value = asRows(data)
      .map(mapCatalog)
      .filter((i): i is CatalogItem => Boolean(i));
    if (
      selectedClave.value &&
      !catalogo.value.some((i) => String(i.clave) === String(selectedClave.value))
    ) {
      selectedClave.value = null;
    }
  } catch (e) {
    catalogo.value = [];
    error.value = e instanceof Error ? e.message : "Error buscando servicios";
  } finally {
    searching.value = false;
  }
}

function pickCatalog(item: CatalogItem) {
  selectedClave.value = item.clave;
  if (item.indicaciones && !datos.value.trim()) datos.value = item.indicaciones;
}

function mapRegistrada(tipo: Categoria, label: string, row: Record<string, unknown>, idx: number): SolRow {
  const clave = String(
    row.clave ?? row.cveEstudio ?? row.cve_estudio ?? row.espserv_interc ?? idx,
  ).trim();
  const descripcion = String(
    row.estudio ||
      row.descEstudio ||
      row.estudioSolicitado ||
      row.estudios ||
      row.especialidad ||
      row.descripcion ||
      clave,
  ).trim();
  const estRaw = String(row.estatusEstudio || row.estatus || row.solc_procesado || "").toUpperCase();
  let estatus: EstatusSol = "ELABORADA";
  if (estRaw.includes("CANCEL") || estRaw === "C") estatus = "CANCELADA";
  else if (estRaw.includes("REALIZ") || estRaw.includes("TERMIN") || estRaw === "S" || estRaw === "R") {
    estatus = "REALIZADO";
  }
  return {
    id: `${tipo}-${clave || idx}`,
    tipo,
    servicio: label,
    descripcion: descripcion || label,
    clave,
    estatus,
  };
}

async function loadRegistradas() {
  if (!props.folio) {
    registradas.value = [];
    return;
  }
  const out: SolRow[] = [];
  await Promise.all(
    CATEGORIAS.map(async (cat) => {
      try {
        const res = await post<unknown>("/ece/nota/solicitudmedica", {
          ...auth(),
          seccion: cat.seccion,
        });
        asRows(res).forEach((row, idx) => out.push(mapRegistrada(cat.value, cat.label, row, idx)));
      } catch {
        /* 404/vacío: sin solicitudes de este tipo */
      }
    }),
  );
  registradas.value = out;
}

async function agregar() {
  if (props.readOnly) {
    error.value = "El alta de solicitudes se realiza desde la forma 11-5. Aquí solo consulta.";
    return;
  }
  if (!props.folio) {
    error.value = "No hay folio de consulta";
    return;
  }
  if (!selectedItem.value) {
    error.value = "Seleccione un servicio del catálogo";
    return;
  }
  loading.value = true;
  error.value = "";
  okMsg.value = "";
  try {
    const clave = Number(selectedItem.value.clave);
    if (categoria.value === "LAB") {
      await post("/ece/nota/ce/solicitud/lab/create", { ...auth(), cveEstudio: clave });
    } else if (categoria.value === "BACT") {
      await post("/ece/nota/ce/solicitud/bacteriologia/create", {
        ...auth(),
        cveEstudio: clave,
        cieCultivo: (props.diagnostico || "").slice(0, 10),
      });
    } else if (categoria.value === "IMG") {
      await post("/ece/nota/ce/solicitud/imagen/create", {
        ...auth(),
        cveEstudio: clave,
        solcInteresa: datos.value.trim(),
      });
    } else {
      await post("/ece/nota/ce/solicitud/interconsulta/create", {
        ...auth(),
        espservInterc: clave,
        datosSolic: datos.value.trim(),
      });
    }
    okMsg.value = `${catMeta.value.label} · ${selectedItem.value.descripcion}`;
    selectedClave.value = null;
    datos.value = "";
    await loadRegistradas();
  } catch (e) {
    error.value = e instanceof Error ? e.message : "No se pudo agregar el servicio";
  } finally {
    loading.value = false;
  }
}

function cancelar() {
  if (!selectedRegId.value) {
    error.value = "Seleccione una solicitud registrada para cancelar";
    return;
  }
  error.value = "La cancelación de solicitudes no está en el API migrado";
}

function imprimir() {
  const fuente = registradas.value.filter((r) => printIds.value.includes(r.id));
  if (!fuente.length) {
    error.value = "Seleccione al menos una solicitud";
    return;
  }
  const win = window.open("", "_blank", "noopener,noreferrer,width=800,height=700");
  if (!win) {
    error.value = "El navegador bloqueó la ventana de impresión";
    return;
  }
  const rowsHtml = fuente
    .map(
      (r, i) =>
        `<tr><td>${i + 1}</td><td>${r.servicio}</td><td>${r.descripcion}</td><td>${r.estatus}</td></tr>`,
    )
    .join("");
  win.document.write(`<!doctype html><html><head><title>Solicitud de servicios</title>
    <style>body{font-family:sans-serif;padding:24px}table{width:100%;border-collapse:collapse}
    th,td{border:1px solid #ccc;padding:6px 8px;text-align:left}th{background:#eee}</style></head>
    <body><h2>Solicitud de servicios</h2><p>${props.pacienteLine}</p>
    <table><thead><tr><th>No</th><th>Servicio</th><th>Descripción</th><th>Estatus</th></tr></thead>
    <tbody>${rowsHtml}</tbody></table></body></html>`);
  win.document.close();
  win.focus();
  win.print();
}

function togglePrint(id: string, on: boolean) {
  if (on) {
    if (!printIds.value.includes(id)) printIds.value = [...printIds.value, id];
  } else {
    printIds.value = printIds.value.filter((x) => x !== id);
  }
}

function close() {
  open.value = false;
  emit("close");
}

watch(open, async (v) => {
  if (!v) return;
  error.value = "";
  okMsg.value = "";
  q.value = "";
  datos.value = "";
  selectedClave.value = null;
  selectedRegId.value = null;
  printIds.value = [];
  filtroEstatus.value = "ELABORADA";
  await loadUnidad();
  await Promise.all([buscarCatalogo(""), loadRegistradas()]);
});

watch(categoria, () => {
  q.value = "";
  datos.value = "";
  selectedClave.value = null;
  void buscarCatalogo("");
});

watch(q, (term) => {
  if (!open.value) return;
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => void buscarCatalogo(term), 250);
});
</script>

<template>
  <UModal v-model:open="open" :ui="{ content: 'max-w-6xl w-full' }">
    <template #content>
      <div class="flex max-h-[min(92vh,860px)] flex-col">
        <div class="flex flex-wrap items-center gap-2 border-b border-default bg-elevated px-4 py-3">
          <UAlert
            v-if="readOnly"
            color="info"
            variant="subtle"
            class="w-full"
            title="Solo consulta"
            description="El registro de solicitudes se realiza desde la forma 11-5. Aquí puede revisar e imprimir lo ya elaborado."
          />
          <UButton
            v-if="!readOnly"
            label="AGREGA SERVICIO"
            icon="i-lucide-save"
            color="primary"
            size="sm"
            :loading="loading"
            :disabled="!selectedItem"
            @click="agregar"
          />
          <UButton
            v-if="!readOnly"
            label="CANCELAR SERVICIO"
            icon="i-lucide-x"
            color="error"
            variant="soft"
            size="sm"
            :disabled="!selectedRegId"
            @click="cancelar"
          />
          <UButton
            label="IMPRIME SOLICITUD"
            icon="i-lucide-printer"
            color="neutral"
            variant="soft"
            size="sm"
            @click="imprimir"
          />
          <h2 class="ml-auto text-sm font-bold uppercase tracking-wide text-highlighted">
            Solicitud de servicios
          </h2>
        </div>

        <p class="border-b border-default px-4 py-2 text-xs font-semibold uppercase text-primary m-0">
          {{ pacienteLine }}
        </p>

        <div class="space-y-2 overflow-y-auto p-3">
          <UAlert v-if="error" color="error" variant="subtle" :title="error" />
          <UAlert v-if="okMsg" color="success" variant="subtle" :title="`Servicio registrado · ${okMsg}`" />

          <div class="grid gap-3 lg:grid-cols-2">
            <div v-if="!readOnly" class="space-y-3">
              <UCard
                :ui="{
                  root: 'overflow-hidden w-full',
                  header: 'px-3 py-2 bg-inverted',
                  body: 'p-3 space-y-3',
                }"
              >
                <template #header>
                  <span class="text-xs font-bold uppercase tracking-wide text-inverted">
                    Seleccione servicio
                  </span>
                </template>
                <UFormField label="Tipo">
                  <USelect
                    v-model="categoria"
                    :items="CATEGORIAS"
                    value-key="value"
                    label-key="label"
                    size="sm"
                    class="w-full"
                  />
                </UFormField>
              </UCard>

              <UCard
                :ui="{
                  root: 'overflow-hidden w-full',
                  header: 'px-3 py-2 bg-inverted',
                  body: 'p-0',
                }"
              >
                <template #header>
                  <span class="text-xs font-bold uppercase tracking-wide text-inverted">Servicio</span>
                </template>
                <div class="flex items-end gap-2 p-3">
                  <UFormField label="Buscar" class="min-w-0 flex-1">
                    <UInput
                      v-model="q"
                      size="sm"
                      icon="i-lucide-search"
                      :loading="searching"
                      placeholder="Ej. examen general, biometría…"
                      autocomplete="off"
                      @keydown.enter.prevent="buscarCatalogo(q)"
                    />
                  </UFormField>
                  <UButton
                    icon="i-lucide-search"
                    color="primary"
                    variant="soft"
                    size="sm"
                    :loading="searching"
                    @click="buscarCatalogo(q)"
                  />
                </div>
                <div class="overflow-x-auto max-h-52 border-t border-default">
                  <table class="w-full text-xs border-collapse">
                    <thead>
                      <tr class="bg-inverted text-inverted">
                        <th class="px-2 py-1.5 text-left font-bold">SERVICIO</th>
                        <th class="px-2 py-1.5 text-left font-bold w-20">UNIDAD</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr v-if="!catalogo.length">
                        <td colspan="2" class="px-2 py-4 text-center text-muted">
                          {{
                            searching
                              ? "Buscando…"
                              : q.trim()
                                ? "Sin coincidencias en el catálogo."
                                : "Escriba para buscar o seleccione un renglón."
                          }}
                        </td>
                      </tr>
                      <tr
                        v-for="item in catalogo"
                        :key="String(item.clave)"
                        class="cursor-pointer border-t border-default hover:bg-elevated"
                        :class="{ 'bg-primary/10': String(selectedClave) === String(item.clave) }"
                        @click="pickCatalog(item)"
                      >
                        <td class="px-2 py-1.5 font-semibold text-primary">
                          {{ catMeta.label }} — {{ item.descripcion }}
                        </td>
                        <td class="px-2 py-1.5">{{ item.unidad }}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </UCard>

              <UCard
                :ui="{
                  root: 'overflow-hidden w-full',
                  header: 'px-3 py-2 bg-inverted',
                  body: 'p-3',
                }"
              >
                <template #header>
                  <span class="text-xs font-bold uppercase tracking-wide text-inverted">
                    Datos solicitados
                  </span>
                </template>
                <UTextarea
                  v-model="datos"
                  :rows="4"
                  autoresize
                  placeholder="Indicaciones o datos clínicos de interés…"
                  class="w-full"
                />
              </UCard>
            </div>

            <UCard
              :ui="{
                root: 'overflow-hidden w-full h-full',
                header: 'px-3 py-2 bg-inverted',
                body: 'p-0',
              }"
            >
              <template #header>
                <span class="text-xs font-bold uppercase tracking-wide text-warning">
                  Solicitudes registradas por el médico
                </span>
              </template>
              <div class="overflow-x-auto max-h-[28rem]">
                <table class="w-full text-xs border-collapse">
                  <thead>
                    <tr class="bg-inverted text-inverted">
                      <th class="px-2 py-1.5 text-left font-bold w-10">No</th>
                      <th class="px-2 py-1.5 text-left font-bold">SERVICIO</th>
                      <th class="px-2 py-1.5 text-left font-bold">DESCRIPCIÓN DEL SERVICIO</th>
                      <th class="px-2 py-1.5 text-center font-bold w-24">IMPRIMIR</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-if="!registradasFiltradas.length">
                      <td colspan="4" class="px-2 py-6 text-center text-muted">
                        Sin solicitudes en este estatus.
                      </td>
                    </tr>
                    <tr
                      v-for="(row, idx) in registradasFiltradas"
                      :key="row.id"
                      class="cursor-pointer border-t border-default hover:bg-elevated"
                      :class="{ 'bg-primary/10': selectedRegId === row.id }"
                      @click="selectedRegId = row.id"
                    >
                      <td class="px-2 py-1.5">{{ idx + 1 }}</td>
                      <td class="px-2 py-1.5 text-primary">{{ row.servicio }}</td>
                      <td class="px-2 py-1.5 font-semibold text-primary">
                        {{ row.servicio }} — {{ row.descripcion }}
                      </td>
                      <td class="px-2 py-1.5 text-center" @click.stop>
                        <UCheckbox
                          :model-value="printIds.includes(row.id)"
                          @update:model-value="togglePrint(row.id, Boolean($event))"
                        />
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <div class="grid grid-cols-3 text-[0.65rem] font-bold uppercase tracking-wide">
                <button
                  type="button"
                  class="px-2 py-2 text-center"
                  :class="
                    filtroEstatus === 'ELABORADA'
                      ? 'bg-primary text-inverted'
                      : 'bg-primary/20 text-primary'
                  "
                  @click="filtroEstatus = 'ELABORADA'"
                >
                  Solicitudes elaboradas
                </button>
                <button
                  type="button"
                  class="px-2 py-2 text-center"
                  :class="
                    filtroEstatus === 'REALIZADO'
                      ? 'bg-success text-inverted'
                      : 'bg-success/20 text-success'
                  "
                  @click="filtroEstatus = 'REALIZADO'"
                >
                  Estudios realizados
                </button>
                <button
                  type="button"
                  class="px-2 py-2 text-center"
                  :class="
                    filtroEstatus === 'CANCELADA'
                      ? 'bg-error text-inverted'
                      : 'bg-error/20 text-error'
                  "
                  @click="filtroEstatus = 'CANCELADA'"
                >
                  Solicitudes canceladas
                </button>
              </div>
            </UCard>
          </div>
        </div>

        <div class="flex justify-center border-t border-default px-4 py-3">
          <UButton label="SALIR" variant="outline" color="neutral" icon="i-lucide-log-out" @click="close" />
        </div>
      </div>
    </template>
  </UModal>
</template>
