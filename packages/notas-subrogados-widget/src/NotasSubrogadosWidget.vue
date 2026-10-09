<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from "vue";
import AtmedSectionCard from "./components/AtmedSectionCard.vue";
import AtmedDatePicker from "./components/AtmedDatePicker.vue";
import CatalogAutocomplete from "./components/CatalogAutocomplete.vue";
import SignosVitalesModal from "./components/SignosVitalesModal.vue";
import ServiciosModal from "./components/ServiciosModal.vue";
import "./style.css";
import type { SessionAuth } from "./types";

/** Modal tipo SweetAlert (solo Aceptar) para confirmaciones, errores y validaciones. */
const alertOpen = ref(false);
const alertState = reactive({
  title: "Información",
  description: "",
  color: "info" as "success" | "error" | "warning" | "info" | "primary",
  icon: "i-lucide-info",
});

const ALERT_PRESETS = {
  success: {
    title: "Operación exitosa",
    color: "success" as const,
    icon: "i-lucide-circle-check",
  },
  error: {
    title: "No fue posible completar la operación",
    color: "error" as const,
    icon: "i-lucide-circle-x",
  },
  warning: {
    title: "Validación requerida",
    color: "warning" as const,
    icon: "i-lucide-triangle-alert",
  },
  info: {
    title: "Información",
    color: "info" as const,
    icon: "i-lucide-info",
  },
};

function showAlert(
  type: keyof typeof ALERT_PRESETS,
  description: string,
  title?: string,
) {
  const preset = ALERT_PRESETS[type];
  alertState.title = title || preset.title;
  alertState.description = String(description || "");
  alertState.color = preset.color;
  alertState.icon = preset.icon;
  alertOpen.value = true;
}

function notifySuccess(description: string, title = "Operación exitosa") {
  showAlert("success", description, title);
}

function notifyError(
  description: string,
  title = "No fue posible completar la operación",
) {
  showAlert("error", description, title);
}

function notifyWarning(description: string, title = "Validación requerida") {
  showAlert("warning", description, title);
}

function notifyInfo(description: string, title = "Información") {
  showAlert("info", description, title);
}

/** UTextarea root es inline-flex por defecto; forzar ancho completo en notas. */
const notaTextareaUi = { root: "relative flex w-full items-start" };
const notaFieldUi = { root: "w-full", container: "w-full mt-1" };

const props = withDefaults(
  defineProps<{
    /** Base URL del FastAPI Subrogados (ej. http://127.0.0.1:8002) */
    apiBase: string;
    /** Prefijo opcional de rutas (proxy Laravel) */
    apiPrefix?: string;
    session: SessionAuth;
    /**
     * Menú AGENDA/ASIGNA/CONSULTA del widget.
     * En portal Subrogados (embebido) poner false: el host controla el chrome.
     */
    showModuleNav?: boolean;
    /** Atajo: equivale a showModuleNav=false */
    embedded?: boolean;
    /** Módulo inicial / forzado desde el host (Accesos rápidos). */
    initialModule?: "agenda" | "asignar" | "consulta" | null;
  }>(),
  { apiPrefix: "", showModuleNav: true, embedded: false, initialModule: null },
);

const emit = defineEmits<{
  openExpediente: [
    payload: {
      ficha: string;
      codigo: string;
      empresa?: number;
      hosi_folio?: number;
      unitrab?: number | string;
    },
  ];
  openReceta: [
    payload: {
      ficha: string;
      codigo: string;
      empresa: number;
      hosi_folio?: number;
      paciente?: string;
      diagnostico?: string;
      unitrab?: number | string;
    },
  ];
  /** Host resuelve y descarga plan alimenticio + rutina según IMC. */
  openPlanNutricional: [
    payload: {
      clasificacion: string;
      imc: number | null;
      ficha?: string;
      hosi_folio?: number;
    },
  ];
  /** Host abre Forma 11-5 / Solicitudes con el folio de la nota grabada. */
  openSolicitudes: [
    payload: {
      hosi_folio: number;
      ficha?: string;
      codigo?: string;
      unitrab?: number | string;
    },
  ];
  /** Host abre la bandeja de interconsultas. */
  openInterconsultas: [];
  /** Notifica al host el folio activo y si la nota ya está grabada. */
  consultaGuardada: [payload: { hosi_folio: number; saved: boolean }];
}>();

const showChromeNav = computed(() => props.showModuleNav && !props.embedded);
/** Rol Subrogados: R = recepcionista (sin clínica). */
const sessionRol = computed(() => String(props.session?.rol || "").trim().toUpperCase());
const esRecepcionista = computed(() => sessionRol.value === "R");
const puedeClinica = computed(() => !["R", "F"].includes(sessionRol.value));
/** Médico autenticado: no cambia de médico/especialidad ajenos. */
const medicoSesionLocked = ref(false);
const medicoSesionFicha = ref("");
const tipoconMotivo = ref("");
const citaEstatusCat = ref<{ cits_estatus: number; etiqueta: string }[]>([]);
const loading = ref(false);
const error = ref("");
const okMsg = ref("");
const rows = ref<Record<string, unknown>[]>([]);
const fecha = ref(new Date().toISOString().slice(0, 10));
const tab = ref<"agenda" | "asignar" | "consulta">("agenda");
/** Rail izquierdo: menú de módulos + calendario (solo Asignar; Agenda/Nota usan layout focus/tabs). */
const showAsideRail = computed(
  () => showChromeNav.value || tab.value === "asignar",
);
const sidebarTabActive = computed(() => tab.value);
/** Filtro de foco de la agenda (prototipo citas). */
const agendaFocusTab = ref<"todo" | "wait" | "done" | "all">("todo");
const agendaDrawerOpen = ref(false);
/** Tabs de captura de nota (prototipo tabs). */
const consultaUiTab = ref<"vitals" | "clinical" | "diagnostic" | "history">("vitals");
const patientDialogOpen = ref(false);
const CONSULTA_TAB_ORDER = ["vitals", "clinical", "diagnostic", "history"] as const;

const especialidades = ref<{ esps_espserv: number; espc_descrip: string; requiere_signos: string }[]>([]);
const medicos = ref<
  { medc_ficha: string; medc_codigo: string; medc_nombre: string; esps_espserv: number; espc_descrip: string }[]
>([]);
const horas = ref<{ hora: number; label: string }[]>([]);
const empresasCat = ref<{ emp_clave: number; emp_descrip: string }[]>([]);
const beneficiariosFicha = ref<
  { derc_codigo: string; ders_empresa: string; nombre_completo: string }[]
>([]);

/** Códigos de familiar frecuentes (catálogo de selección). */
const CODIGOS_CATALOGO = [
  { value: "00", label: "00 — Titular" },
  { value: "01", label: "01 — Cónyuge" },
  { value: "02", label: "02 — Hijo(a)" },
  { value: "03", label: "03 — Padre/Madre" },
  { value: "04", label: "04 — Hermano(a)" },
  { value: "08", label: "08 — Otro familiar" },
  { value: "10", label: "10 — Beneficiario" },
];

const asignar = reactive({
  ficha: "",
  codigo: "00",
  empresa: 0,
  esps_espserv: 101,
  medc_ficha: "900002",
  medc_codigo: "00",
  medicoKey: "900002|00|101",
  fecha: new Date().toISOString().slice(0, 10),
  hora: 900,
  folioConsulta: "",
  observaciones: "",
});
const asignando = ref(false);
const pacienteBuscado = ref(false);
const citasPaciente = ref<Record<string, unknown>[]>([]);
const asignarOkFolio = ref("");
const buscarHint = ref("Ingrese los datos del paciente para buscarlo en el sistema.");
const agendaAsignarPage = ref(1);
const AGENDA_ASIGNAR_PAGE_SIZE = 10;
const TABLE_PAGE_SIZE = 10;
const agendaPage = ref(1);
const agendaBusqueda = ref("");
const historialPage = ref(1);
const historialBusqueda = ref("");

const paciente = reactive({
  loading: false,
  nombre: "",
  ct: "",
  depto: "",
  org: "",
  edad: "",
  sx: "",
  rc: "",
  uma: "",
  umaDescri: "",
  procedencia: "",
  vigencia: "",
  estatusVigencia: "",
});

const photoFailed = ref(false);
const selectedAgendaRow = ref<Record<string, unknown> | null>(null);
const calMonth = ref(new Date().toISOString().slice(0, 7));

const DIAS_SEMANA = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const DIAS_CAL = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
const MESES = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
];

const sidebarNavAll = [
  { id: "agenda", label: "AGENDA MEDICA", kind: "module" as const },
  { id: "asignar", label: "ASIGNA CITA", kind: "module" as const },
  { id: "consulta", label: "CONSULTA", kind: "module" as const },
  { id: "interconsultas", label: "INTERCONSULTAS", kind: "host" as const },
] as const;

const sidebarNav = computed(() =>
  esRecepcionista.value
    ? sidebarNavAll.filter((n) => n.id !== "consulta")
    : [...sidebarNavAll],
);

function onSidebarNavClick(nav: (typeof sidebarNavAll)[number]) {
  if (nav.kind === "host") {
    if (nav.id === "interconsultas") emit("openInterconsultas");
    return;
  }
  tab.value = nav.id as typeof tab.value;
}

const consulta = reactive({
  hosi_folio: 0,
  sintomas: "",
  objetivo: "",
  analisis: "",
  plan: "",
  diai_clacie1: "",
  diai_clacie2: "",
  diai_clacie3: "",
  diai_clacie4: "",
  diai_clacie5: "",
  motivoCie10: "",
  motivoConsulta: "",
  diagnosticoTexto: "",
  diagnosticoTexto2: "",
  diagnosticoTexto3: "",
  diagnosticoTexto4: "",
  diagnosticoTexto5: "",
  enfermedadPrimeraVez: false,
  enfermedadSub: false,
  conn_tipocon: "",
});

const notaBloqueada = ref(false);
const consultaOkLocal = ref(false);
const dxSlotsVisible = ref(1);
const adendumOpen = ref(false);
const adendumTexto = ref("");
const historialNotas = ref<Record<string, unknown>[]>([]);
const agendaFiltroEsp = ref<number | null>(null);
const agendaFiltroMed = ref<string | null>(null);
const agendaFiltroEstatus = ref<number | null>(null);
const antecedentesVisitados = ref(false);
const alergiasLista = ref<string[]>([]);
const alergiaNueva = ref("");
/** Claves del catálogo seleccionadas (multi). Puede incluir OTRO para captura libre. */
const alergiaCatalogoSel = ref<string[]>([]);
const alergiaOtroTexto = ref("");
const alergiasCatalogo = ref<{ clave: string; descripcion: string }[]>([]);
const loadingAlergiasCatalogo = ref(false);
const alergiasCatalogoError = ref("");
const syncingAlergiaCatalogoSel = ref(false);
const signosPanelOpen = ref(true);

const notaCronica = reactive({
  diabetes: "negativo" as "negativo" | "positivo",
  hipertension: "negativo" as "negativo" | "positivo",
  obesidad: "negativo" as "negativo" | "positivo",
  alergias: "negativo" as "negativo" | "positivo",
  alergiasDetalle: "",
});
/** Estado de censo al abrir la consulta (para confirmar altas nuevas). */
const censoBase = reactive({
  diabetes: false,
  hipertension: false,
  obesidad: false,
});
const censoConfirmOpen = ref(false);
const censoConfirmPendientes = ref<string[]>([]);

const procedimientosSel = ref<{ clave: string; descripcion: string }[]>([]);
const procQ = ref("");

function onPickCieMotivo(hit: { clave: string; descripcion: string }) {
  if (notaBloqueada.value) return;
  consulta.motivoCie10 = hit.clave.slice(0, 5).toUpperCase();
  if (!consulta.motivoConsulta.trim()) consulta.motivoConsulta = hit.descripcion;
}

function setTipoConsulta(primeraVez: boolean, motivo?: string) {
  if (notaBloqueada.value) return;
  consulta.enfermedadPrimeraVez = primeraVez;
  consulta.enfermedadSub = !primeraVez;
  consulta.conn_tipocon = primeraVez ? "P" : "S";
  tipoconMotivo.value = motivo ?? "Marcado manualmente por el médico";
}

async function aplicarTipoconSugerido(cie?: string) {
  if (notaBloqueada.value || !citaCtx.ficha) return;
  try {
    const res = await post<{ record?: Record<string, unknown>; mensaje?: string }>(
      "/sub/atmed/consulta/tipocon-sugerido",
      {
        ...props.session,
        ficha: citaCtx.ficha,
        codigo: citaCtx.codigo || "00",
        empresa: citaCtx.empresa || 0,
        esps_espserv: citaCtx.esps_espserv || undefined,
        diai_clacie1: (cie || consulta.diai_clacie1 || "").trim(),
      },
    );
    const r = res.record || {};
    const tip = String(r.conn_tipocon || "P").toUpperCase().slice(0, 1) || "P";
    setTipoConsulta(tip !== "S", String(r.motivo || res.mensaje || ""));
  } catch {
    /* sugerencia opcional */
  }
}

function onPickCieDx(hit: { clave: string; descripcion: string }, slot = 1) {
  if (notaBloqueada.value) return;
  const clave = hit.clave.slice(0, 5).toUpperCase();
  if (slot === 1) {
    consulta.diai_clacie1 = clave;
    consulta.diagnosticoTexto = hit.descripcion;
    void aplicarTipoconSugerido(clave);
  } else if (slot === 2) {
    consulta.diai_clacie2 = clave;
    consulta.diagnosticoTexto2 = hit.descripcion;
  } else if (slot === 3) {
    consulta.diai_clacie3 = clave;
    consulta.diagnosticoTexto3 = hit.descripcion;
  } else if (slot === 4) {
    consulta.diai_clacie4 = clave;
    consulta.diagnosticoTexto4 = hit.descripcion;
  } else {
    consulta.diai_clacie5 = clave;
    consulta.diagnosticoTexto5 = hit.descripcion;
  }
}

function agregarDiagnostico() {
  if (notaBloqueada.value) return;
  if (dxSlotsVisible.value < 5) dxSlotsVisible.value += 1;
}

function onPickProcedimiento(hit: { clave: string; descripcion: string }) {
  if (notaBloqueada.value) return;
  if (procedimientosSel.value.some((p) => p.clave === hit.clave)) return;
  procedimientosSel.value.push({ clave: hit.clave, descripcion: hit.descripcion });
  procQ.value = "";
  const line = `PROCEDIMIENTO: ${hit.clave} ${hit.descripcion}`.trim();
  const plan = (consulta.plan || "").trim();
  if (!plan.includes(hit.clave)) {
    consulta.plan = plan ? `${plan}\n${line}` : line;
  }
}

function quitarProcedimiento(clave: string) {
  if (notaBloqueada.value) return;
  procedimientosSel.value = procedimientosSel.value.filter((p) => p.clave !== clave);
}
function syncAlergiasDetalleFromLista() {
  notaCronica.alergiasDetalle = alergiasLista.value.join("\n");
}

function catalogDescripcionesLower(): Set<string> {
  return new Set(
    alergiasCatalogo.value
      .filter((a) => a.clave !== "OTRO")
      .map((a) => a.descripcion.toLowerCase()),
  );
}

/** Reconstruye la lista: seleccionados del catálogo + capturas libres (Otro). */
function syncListaFromCatalogoSel() {
  const fromCatalog = alergiaCatalogoSel.value
    .filter((c) => c !== "OTRO")
    .map((c) => alergiasCatalogo.value.find((a) => a.clave === c)?.descripcion || c)
    .map((s) => s.trim())
    .filter(Boolean);

  const catalogLower = catalogDescripcionesLower();
  const customs = alergiasLista.value.filter((a) => !catalogLower.has(a.toLowerCase()));

  const merged: string[] = [];
  for (const label of [...fromCatalog, ...customs]) {
    if (!merged.some((m) => m.toLowerCase() === label.toLowerCase())) {
      merged.push(label);
    }
  }
  alergiasLista.value = merged;
  syncAlergiasDetalleFromLista();
  syncCronicosEnAnalisis();
}

/** Marca en el multi-select las alergias de la lista que existen en catálogo. */
function syncCatalogoSelFromLista() {
  const sel: string[] = [];
  const keepOtro = alergiaCatalogoSel.value.includes("OTRO");
  for (const a of alergiasLista.value) {
    const hit = alergiasCatalogo.value.find(
      (c) => c.clave !== "OTRO" && c.descripcion.toLowerCase() === a.toLowerCase(),
    );
    if (hit && !sel.includes(hit.clave)) sel.push(hit.clave);
  }
  if (keepOtro) sel.push("OTRO");
  syncingAlergiaCatalogoSel.value = true;
  alergiaCatalogoSel.value = sel;
  syncingAlergiaCatalogoSel.value = false;
}

function agregarAlergia() {
  if (notaBloqueada.value) return;
  const t = alergiaNueva.value.trim();
  if (!t) return;
  if (!alergiasLista.value.some((a) => a.toLowerCase() === t.toLowerCase())) {
    alergiasLista.value.push(t);
  }
  alergiaNueva.value = "";
  syncAlergiasDetalleFromLista();
  syncCronicosEnAnalisis();
}

/** Agrega alérgeno capturado en «Otro» (texto libre); las del catálogo ya van por multi-select. */
function agregarAlergiaDesdeCatalogo() {
  if (notaBloqueada.value) return;
  if (!alergiaCatalogoSel.value.includes("OTRO")) return;
  const label = alergiaOtroTexto.value.trim();
  if (!label) return;
  if (!alergiasLista.value.some((a) => a.toLowerCase() === label.toLowerCase())) {
    alergiasLista.value.push(label);
  }
  alergiaOtroTexto.value = "";
  // Quitar OTRO del select para permitir otra captura libre después
  syncingAlergiaCatalogoSel.value = true;
  alergiaCatalogoSel.value = alergiaCatalogoSel.value.filter((c) => c !== "OTRO");
  syncingAlergiaCatalogoSel.value = false;
  syncAlergiasDetalleFromLista();
  syncCronicosEnAnalisis();
}

const alergiaSelectItems = computed(() =>
  alergiasCatalogo.value.map((a) => ({
    value: a.clave,
    label: a.descripcion,
  })),
);

const alergiaOtroSeleccionado = computed(() => alergiaCatalogoSel.value.includes("OTRO"));

watch(
  alergiaCatalogoSel,
  () => {
    if (syncingAlergiaCatalogoSel.value || notaBloqueada.value) return;
    syncListaFromCatalogoSel();
  },
  { deep: true },
);

async function loadAlergiasCatalogo(q = "") {
  loadingAlergiasCatalogo.value = true;
  alergiasCatalogoError.value = "";
  try {
    const data = await post<{ rows: Record<string, unknown>[] }>("/sub/catalogos/buscar", {
      ...props.session,
      tipo: "alergias",
      q,
      limit: 200,
    });
    const rows = (data.rows || [])
      .map((r) => ({
        clave: String(r.clave || r.descripcion || "").trim(),
        descripcion: String(r.descripcion || r.clave || "").trim(),
      }))
      .filter((r) => r.clave && r.descripcion);
    if (!rows.some((a) => a.clave === "OTRO")) {
      rows.push({ clave: "OTRO", descripcion: "Otro (especificar)" });
    }
    alergiasCatalogo.value = rows;
    if (rows.length <= 1) {
      alergiasCatalogoError.value = "El catálogo de alérgenos no devolvió registros.";
    }
    syncCatalogoSelFromLista();
  } catch (e) {
    alergiasCatalogo.value = [{ clave: "OTRO", descripcion: "Otro (especificar)" }];
    alergiasCatalogoError.value =
      e instanceof Error ? e.message : "No se pudo cargar el catálogo de alergias.";
  } finally {
    loadingAlergiasCatalogo.value = false;
  }
}

function onAlergiaSelectOpen(isOpen: boolean) {
  if (isOpen && alergiasCatalogo.value.length <= 1) {
    void loadAlergiasCatalogo("");
  }
}

function quitarAlergia(idx: number) {
  if (notaBloqueada.value) return;
  alergiasLista.value.splice(idx, 1);
  syncCatalogoSelFromLista();
  syncAlergiasDetalleFromLista();
  syncCronicosEnAnalisis();
}

function loadAlergiasListaFromTexto(txt: string) {
  const lines = String(txt || "")
    .split(/\n+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((l) => {
      const u = l.toUpperCase();
      return !u.includes("NO REGISTRADAS") && !u.startsWith("ANTECEDENTES CRONICOS");
    })
    .flatMap((l) => {
      const m = l.match(/^PACIENTE REFIERE SER ALERGICO A\s+(.+)$/i);
      const body = (m ? m[1] : l).trim();
      if (m && body.includes(",")) {
        return body.split(/\s*,\s*/).map((s) => s.trim()).filter(Boolean);
      }
      return [body];
    })
    .filter(Boolean);
  alergiasLista.value = lines.filter(
    (a, i, arr) => arr.findIndex((x) => x.toLowerCase() === a.toLowerCase()) === i,
  );
  syncCatalogoSelFromLista();
  syncAlergiasDetalleFromLista();
}

function toggleCronico(campo: "diabetes" | "hipertension" | "obesidad" | "alergias") {
  if (notaBloqueada.value) return;
  antecedentesVisitados.value = true;
  notaCronica[campo] = notaCronica[campo] === "positivo" ? "negativo" : "positivo";
  if (campo === "alergias" && notaCronica.alergias === "negativo") {
    alergiasLista.value = [];
    alergiaNueva.value = "";
    syncingAlergiaCatalogoSel.value = true;
    alergiaCatalogoSel.value = [];
    syncingAlergiaCatalogoSel.value = false;
    alergiaOtroTexto.value = "";
    alergiasCatalogoError.value = "";
    notaCronica.alergiasDetalle = "ALERGIAS NO REGISTRADAS";
  }
  if (campo === "alergias" && notaCronica.alergias === "positivo") {
    void loadAlergiasCatalogo("");
  }
  syncCronicosEnAnalisis();
}

function syncCronicosEnAnalisis() {
  if (notaBloqueada.value) return;
  const flag = (v: string) => (v === "positivo" ? "REGISTRADA" : "NO REGISTRADA");
  const lineas = [
    `ANTECEDENTES CRONICOS: DIABETES ${flag(notaCronica.diabetes)}, ` +
      `HIPERTENSION ${flag(notaCronica.hipertension)}, ` +
      `OBESIDAD/SOBREPESO ${flag(notaCronica.obesidad)}.`,
  ];
  if (notaCronica.alergias === "positivo") {
    const det =
      alergiasLista.value.join(", ").trim() ||
      (notaCronica.alergiasDetalle || "").replace(/\n+/g, ", ").trim() ||
      "ALERGIA REFERIDA";
    lineas.push(
      det.startsWith("PACIENTE REFIERE") || det.startsWith("ALERGIAS")
        ? det
        : `PACIENTE REFIERE SER ALERGICO A ${det}`,
    );
  } else {
    lineas.push("ALERGIAS NO REGISTRADAS");
  }
  const block = lineas.join("\n");
  const re = /ANTECEDENTES CRONICOS:[\s\S]*?(?=\n\n|$)/i;
  const analisis = (consulta.analisis || "").trim();
  if (re.test(analisis)) {
    consulta.analisis = analisis.replace(re, block).trim();
  } else if (!analisis) {
    consulta.analisis = block;
  } else {
    consulta.analisis = `${block}\n\n${analisis}`.trim();
  }
}

const consultaPhotoFailed = ref(false);
const consultaLoadedFolio = ref(0);

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
  saturacion: "",
});

type SignosRow = {
  hosi_folio?: number;
  pulso?: string | number;
  respiracion?: string | number;
  tension_sis?: string | number;
  tension_dia?: string | number;
  temperatura?: string | number;
  peso?: string | number;
  estatura?: string | number;
  abdominal?: string | number;
  saturacion?: string | number;
  fecha?: string;
  created_at?: string;
};

const signosModalOpen = ref(false);
const serviciosModalOpen = ref(false);
const ultimosSignos = ref<SignosRow | null>(null);

function parseSignoNum(v: unknown): number | null {
  const n = Number(String(v ?? "").replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : null;
}

function calcImc(peso: unknown, estatura: unknown): number | null {
  const p = parseSignoNum(peso);
  let e = parseSignoNum(estatura);
  if (!p || !e) return null;
  if (e > 3) e /= 100;
  return Math.round((p / (e * e)) * 100) / 100;
}

function clasificacionImc(imc: number | null): string {
  if (imc == null) return "";
  if (imc < 18.5) return "BAJO PESO";
  if (imc < 25) return "NORMAL";
  if (imc < 30) return "SOBREPESO";
  if (imc < 35) return "OBESIDAD I";
  if (imc < 40) return "OBESIDAD II";
  return "OBESIDAD III";
}

/** Clasificación TA adulta (mmHg) — alerta prehipertenso / hipertenso. */
function clasificacionTension(sisRaw: unknown, diaRaw: unknown): string {
  const sis = parseSignoNum(sisRaw);
  const dia = parseSignoNum(diaRaw);
  if (sis == null || dia == null) return "";
  if (sis >= 140 || dia >= 90) return "HIPERTENSO";
  if (sis >= 130 || dia >= 85) return "PREHIPERTENSO";
  if (sis < 90 || dia < 60) return "HIPOTENSION";
  return "NORMAL";
}

/**
 * Percentil IMC pediátrico aproximado (tablas simplificadas CDC/OMS por edad).
 * No sustituye curvas LMS oficiales; orienta al clínico en menores de 18 años.
 */
function percentilImcPediatrico(
  imc: number | null,
  edadAnios: number,
  sexo: string,
): { etiqueta: string; percentilAprox: string } {
  if (imc == null || !Number.isFinite(edadAnios) || edadAnios < 2 || edadAnios >= 18) {
    return { etiqueta: "", percentilAprox: "" };
  }
  // Puntos de corte BMI aproximados (P5 / P50 / P85 / P95) por banda de edad.
  // Fuente orientativa; validar con curvas oficiales en producción.
  const band = edadAnios < 6 ? 0 : edadAnios < 10 ? 1 : edadAnios < 14 ? 2 : 3;
  const isF = /^F|Mujer|FEM/i.test(sexo || "");
  const cortes = isF
    ? [
        [14.0, 15.5, 17.0, 19.0],
        [14.0, 16.0, 19.0, 22.0],
        [15.0, 18.0, 22.0, 26.0],
        [16.5, 19.5, 24.0, 29.0],
      ]
    : [
        [14.0, 15.5, 17.0, 18.5],
        [14.0, 16.0, 18.5, 21.0],
        [15.0, 17.5, 21.5, 25.0],
        [16.5, 19.0, 23.5, 28.0],
      ];
  const [p5, p50, p85, p95] = cortes[band];
  let etiqueta = "ADECUADO (~P50)";
  let percentilAprox = "~50";
  if (imc < p5) {
    etiqueta = "BAJO PESO (<P5)";
    percentilAprox = "<5";
  } else if (imc < p50) {
    etiqueta = "ADECUADO (P5–P50)";
    percentilAprox = "5–50";
  } else if (imc < p85) {
    etiqueta = "ADECUADO (P50–P85)";
    percentilAprox = "50–85";
  } else if (imc < p95) {
    etiqueta = "SOBREPESO (P85–P95)";
    percentilAprox = "85–95";
  } else {
    etiqueta = "OBESIDAD (≥P95)";
    percentilAprox = "≥95";
  }
  return { etiqueta, percentilAprox };
}

function formatSignosResumenLinea(s: {
  pulso?: unknown;
  respiracion?: unknown;
  tension_sis?: unknown;
  tension_dia?: unknown;
  temperatura?: unknown;
  peso?: unknown;
  estatura?: unknown;
  abdominal?: unknown;
  saturacion?: unknown;
}): string {
  const imc = calcImc(s.peso, s.estatura);
  const imcTxt = imc != null ? String(imc) : "—";
  const clas = clasificacionImc(imc) || "—";
  const taClas = clasificacionTension(s.tension_sis, s.tension_dia);
  const taExtra = taClas ? ` (${taClas})` : "";
  return [
    "SIGNOS VITALES:",
    `PULSO: ${s.pulso || "—"}`,
    `RESPIRACION: ${s.respiracion || "—"}`,
    `TENSION ARTERIAL: ${s.tension_sis || "—"}/${s.tension_dia || "—"} mmHg${taExtra}`,
    `TEMPERATURA: ${s.temperatura || "—"} °C`,
    `PESO: ${s.peso || "—"} KG`,
    `ESTATURA: ${s.estatura || "—"} M`,
    `IMC: ${imcTxt} KG/M² (${clas})`,
    `PERIMETRO ABDOMINAL: ${s.abdominal || "—"} CMS`,
    `SATURACION O2: ${s.saturacion || "—"} %`,
  ].join(" ");
}

// Solo el bloque generado (hasta SATURACION O2). El plan escrito antes o después sí cuenta.
const SIGNOS_PLAN_RE = /SIGNOS VITALES:\s*PULSO:[\s\S]*?SATURACION O2:\s*\S+\s*%/i;

function syncSignosEnPlan(resumen: string) {
  const block = resumen.trim();
  if (!block) return;
  const plan = (consulta.plan || "").trim();
  if (!plan) {
    consulta.plan = block;
    return;
  }
  if (SIGNOS_PLAN_RE.test(plan)) {
    consulta.plan = plan.replace(SIGNOS_PLAN_RE, block).trim();
  } else {
    // Signos al final: el médico escribe el plan clínico arriba / al inicio.
    consulta.plan = `${plan}\n${block}`.trim();
  }
}

const signosTensionClasificacion = computed(() =>
  clasificacionTension(signos.tension_sis, signos.tension_dia),
);
const ultimosTensionClasificacion = computed(() =>
  ultimosSignos.value
    ? clasificacionTension(ultimosSignos.value.tension_sis, ultimosSignos.value.tension_dia)
    : "",
);
const signosResumenConsulta = computed(() => {
  if (!ultimosSignos.value) return "";
  return formatSignosResumenLinea(ultimosSignos.value);
});

const recetasConsulta = ref<Record<string, unknown>[]>([]);

function statusRecetaLabel(raw: unknown): string {
  const u = String(raw || "").toUpperCase();
  if (u === "A1" || u === "PENDIENTE") return "A1";
  if (u === "E1" || u === "ENTREGADA" || u === "SURTIDA") return "E1";
  if (u === "C1" || u === "CANCELADA") return "C1";
  return u || "—";
}

const recetasResumenConsulta = computed(() => {
  if (!recetasConsulta.value.length) return "";
  return recetasConsulta.value
    .map((r) => {
      const est = statusRecetaLabel(r.estatus);
      return `#${r.id} ${r.medicamento || "—"} (${est})`;
    })
    .join(" · ");
});

const consultaRequiereSignos = computed(() => citaCtx.requiere_signos !== "N");

const consultaTieneSignos = computed(() => {
  if (!ultimosSignos.value) return false;
  const folio = Number(ultimosSignos.value.hosi_folio || 0);
  return folio > 0 && folio === Number(citaCtx.hosi_folio || 0);
});

const consultaBloqueadaSinSignos = computed(
  () =>
    Boolean(consulta.hosi_folio) &&
    consultaRequiereSignos.value &&
    !consultaTieneSignos.value,
);

/** Alias UX: bloquea Síntomas/Objetivo igual que el gate de grabar. */
const soapBloqueadoSinSignos = consultaBloqueadaSinSignos;

const agendaAsignarTotalPages = computed(() =>
  Math.max(1, Math.ceil(rows.value.length / AGENDA_ASIGNAR_PAGE_SIZE)),
);

const agendaAsignarPageRows = computed(() => {
  const start = (agendaAsignarPage.value - 1) * AGENDA_ASIGNAR_PAGE_SIZE;
  return rows.value.slice(start, start + AGENDA_ASIGNAR_PAGE_SIZE);
});

const hoyIso = computed(() => new Date().toISOString().slice(0, 10));

const pacienteVigenciaLabel = computed((): "VIGENTE" | "NO VIGENTE" | "SIN DATO" => {
  const raw = (paciente.estatusVigencia || "")
    .toUpperCase()
    .replace(/VIEGENTE/g, "VIGENTE");
  if (raw.includes("NO VIGENTE") || raw.includes("VENCID")) return "NO VIGENTE";
  if (raw.includes("VIGENTE")) return "VIGENTE";
  const vig = (paciente.vigencia || "").slice(0, 10);
  if (vig && vig >= hoyIso.value) return "VIGENTE";
  if (vig && vig < hoyIso.value) return "NO VIGENTE";
  return "SIN DATO";
});

const pacienteVigente = computed(() => {
  const raw = (paciente.estatusVigencia || "")
    .toUpperCase()
    .replace(/VIEGENTE/g, "VIGENTE");
  if (raw.includes("NO VIGENTE") || raw.includes("VENCID")) return false;
  if (raw.includes("VIGENTE")) return true;
  const vig = (paciente.vigencia || "").slice(0, 10);
  if (vig) return vig >= hoyIso.value;
  return false;
});

const citaDuplicadaDia = computed(() => citasPaciente.value.length > 0);

const citaDuplicadaMsg = computed(() => {
  const c = citasPaciente.value[0];
  if (!c) return "";
  const parts = [
    formatFechaDisplay(String(c.citd_fechcita || "").slice(0, 10)),
    formatCitaHoraShort(c.citn_hrcita),
    String(c.especialidad || "").trim(),
    String(c.medico || "").trim(),
    c.hosi_folio != null && c.hosi_folio !== "" ? `folio ${c.hosi_folio}` : "",
  ].filter(Boolean);
  return parts.join(" · ");
});

const especialidadNombre = computed(() => {
  const fromCat = especialidades.value.find((e) => e.esps_espserv === Number(asignar.esps_espserv))?.espc_descrip;
  if (fromCat) return fromCat;
  const fromMed = medicos.value.find(
    (m) =>
      m.medc_ficha === asignar.medc_ficha && Number(m.esps_espserv) === Number(asignar.esps_espserv),
  );
  return fromMed?.espc_descrip || "";
});

const medicoNombre = computed(() => {
  const hit = medicos.value.find(
    (m) =>
      m.medc_ficha === asignar.medc_ficha &&
      Number(m.esps_espserv) === Number(asignar.esps_espserv),
  );
  return hit?.medc_nombre || medicos.value.find((m) => m.medc_ficha === asignar.medc_ficha)?.medc_nombre || "";
});

const codigosOptions = computed(() => {
  const fromDh = new Map<string, string>();
  for (const b of beneficiariosFicha.value) {
    const c = String(b.derc_codigo || "00").padStart(2, "0");
    if (!fromDh.has(c)) {
      const nom = String(b.nombre_completo || "").trim();
      fromDh.set(c, nom ? `${c} — ${nom}` : c);
    }
  }
  if (fromDh.size) {
    return [...fromDh.entries()].map(([value, label]) => ({ value, label }));
  }
  return CODIGOS_CATALOGO;
});

const empresasOptions = computed(() => {
  const base = empresasCat.value.length
    ? empresasCat.value
    : [{ emp_clave: 0, emp_descrip: "0 — Default" }];
  const fromDh = new Set(
    beneficiariosFicha.value.map((b) => Number(b.ders_empresa ?? 0)),
  );
  if (fromDh.size && beneficiariosFicha.value.length) {
    return base.filter((e) => fromDh.has(Number(e.emp_clave)));
  }
  return base;
});

const horaLabel = computed(() => {
  const hit = horas.value.find((h) => h.hora === Number(asignar.hora));
  if (hit?.label) return hit.label.includes("HRS") ? hit.label : `${hit.label} h`;
  return formatCitaHoraShort(asignar.hora);
});

const puedeConfirmarCita = computed(() => {
  if (!pacienteBuscado.value || !String(paciente.nombre || "").trim()) return false;
  if (citaDuplicadaDia.value || asignando.value) return false;
  if (!horas.value.length) return false;
  if (!asignar.fecha || asignar.fecha < hoyIso.value) return false;
  if (!asignar.esps_espserv || !String(asignar.medc_ficha || "").trim()) return false;
  if (!asignar.hora || Number(asignar.hora) <= 0) return false;
  return true;
});

function medicoOptionKey(m: {
  medc_ficha: string;
  medc_codigo: string;
  esps_espserv: number;
}): string {
  return `${m.medc_ficha}|${m.medc_codigo || "00"}|${m.esps_espserv}`;
}

function medicoOptionLabel(m: {
  medc_nombre: string;
  esps_espserv: number;
  espc_descrip?: string;
}): string {
  const esp =
    m.espc_descrip ||
    especialidades.value.find((e) => e.esps_espserv === m.esps_espserv)?.espc_descrip ||
    "";
  return esp ? `${m.medc_nombre} — ${esp}` : m.medc_nombre;
}

function applyMedicoKey(key: string) {
  const [f, c, e] = String(key || "").split("|");
  if (!f) return;
  asignar.medc_ficha = f;
  asignar.medc_codigo = c || "00";
  asignar.esps_espserv = Number(e) || asignar.esps_espserv;
  asignar.medicoKey = medicoOptionKey({
    medc_ficha: asignar.medc_ficha,
    medc_codigo: asignar.medc_codigo,
    esps_espserv: asignar.esps_espserv,
  });
}

function citaYaLlego(row: Record<string, unknown> | null | undefined): boolean {
  if (!row) return false;
  return Number(row.cits_hrllegada) > 0;
}

function citaAtendida(row: Record<string, unknown> | null | undefined): boolean {
  return Number(row?.cits_estatus) >= 4;
}

function puedeRevertirLlegada(row: Record<string, unknown> | null | undefined): boolean {
  if (!row || citaAtendida(row)) return false;
  const est = Number(row.cits_estatus);
  return Number(row.cits_hrllegada) > 0 || est === 2 || est === 3;
}

function puedeIniciarAtencion(row: Record<string, unknown> | null | undefined): boolean {
  if (!row || citaAtendida(row)) return false;
  const est = Number(row.cits_estatus);
  return Number(row.cits_hrllegada) > 0 || est === 2 || est === 3;
}

/** Mínimo provisional (seguimiento); alinear con backend SOAP_MIN_CHARS. */
const SOAP_MIN_CHARS = 20;

function soapLen(text: string, stripSignos = false): number {
  let t = text || "";
  if (stripSignos) t = t.replace(SIGNOS_PLAN_RE, "");
  return t.trim().length;
}

const soapLens = computed(() => ({
  sintomas: soapLen(consulta.sintomas),
  objetivo: soapLen(consulta.objetivo),
  analisis: soapLen(consulta.analisis),
  plan: soapLen(consulta.plan, true),
}));

const soapFaltantes = computed(() => {
  const labels: [keyof typeof soapLens.value, string][] = [
    ["sintomas", "Síntomas / subjetivo"],
    ["objetivo", "Objetivo"],
    ["analisis", "Análisis"],
    ["plan", "Plan"],
  ];
  return labels
    .filter(([key]) => soapLens.value[key] < SOAP_MIN_CHARS)
    .map(([, label]) => label);
});

const soapCompleto = computed(() => soapFaltantes.value.length === 0);

const diagnosticoCapturado = computed(
  () => Boolean(consulta.diai_clacie1.trim()) && Boolean(consulta.diagnosticoTexto.trim()),
);
const diagnosticoCalificado = computed(
  () => consulta.enfermedadPrimeraVez || consulta.enfermedadSub,
);
const puedeGrabarNota = computed(
  () =>
    soapCompleto.value &&
    diagnosticoCapturado.value &&
    diagnosticoCalificado.value &&
    !consultaBloqueadaSinSignos.value &&
    !notaBloqueada.value,
);

watch(diagnosticoCapturado, (ok) => {
  if (ok || notaBloqueada.value) return;
  consulta.enfermedadPrimeraVez = false;
  consulta.enfermedadSub = false;
  consulta.conn_tipocon = "";
  tipoconMotivo.value = "";
});

function soapHint(n: number): string {
  if (n >= SOAP_MIN_CHARS) return `${n} caracteres`;
  return `${n}/${SOAP_MIN_CHARS} (mínimo)`;
}

async function loadRecetasConsulta() {
  recetasConsulta.value = [];
  if (!citaCtx.hosi_folio) return;
  try {
    const data = await post<{ rows?: Record<string, unknown>[] }>("/sub/recetas/list", {
      ...props.session,
      hosi_folio: citaCtx.hosi_folio,
    });
    recetasConsulta.value = data.rows || [];
  } catch {
    recetasConsulta.value = [];
  }
}

function formatSignosFecha(row: SignosRow | null): string {
  if (!row) return "";
  const raw = row.fecha || row.created_at;
  if (!raw) return "";
  const d = new Date(String(raw));
  if (Number.isNaN(d.getTime())) return String(raw).slice(0, 10);
  return d.toLocaleDateString("es-MX", { day: "2-digit", month: "2-digit", year: "numeric" });
}

const signosImc = computed(() => calcImc(signos.peso, signos.estatura));
const signosClasificacion = computed(() => clasificacionImc(signosImc.value));
const ultimosImc = computed(() =>
  ultimosSignos.value ? calcImc(ultimosSignos.value.peso, ultimosSignos.value.estatura) : null,
);
const ultimosClasificacion = computed(() => clasificacionImc(ultimosImc.value));

/** IMC / clasificación vigentes para plan nutricional (toma actual o última registrada). */
const planNutricionalImc = computed(() => signosImc.value ?? ultimosImc.value);
const planNutricionalClasificacion = computed(
  () => signosClasificacion.value || ultimosClasificacion.value || "",
);
const puedePlanNutricional = computed(() => {
  const c = planNutricionalClasificacion.value.toUpperCase();
  return c.includes("SOBREPESO") || c.includes("OBESIDAD");
});
const ultimosFechaLabel = computed(() => formatSignosFecha(ultimosSignos.value));

function limpiarSignosCaptura() {
  signos.pulso = "";
  signos.respiracion = "";
  signos.tension_sis = "";
  signos.tension_dia = "";
  signos.temperatura = "";
  signos.peso = "";
  signos.estatura = "";
  signos.abdominal = "";
  signos.saturacion = "";
}

async function loadUltimosSignos() {
  if (!signos.hosi_folio && !citaCtx.ficha) {
    ultimosSignos.value = null;
    return;
  }
  try {
    const res = await post<{ rows?: SignosRow[] }>("/sub/atmed/signos/ultimos", {
      ...props.session,
      hosi_folio: signos.hosi_folio || undefined,
      ficha: citaCtx.ficha || undefined,
    });
    ultimosSignos.value = res.rows?.[0] ?? null;
  } catch {
    ultimosSignos.value = null;
  }
}

async function openSignosModal() {
  if (!consulta.hosi_folio) {
    error.value = "Seleccione una cita (folio)";
    return;
  }
  signos.hosi_folio = consulta.hosi_folio;
  limpiarSignosCaptura();
  signosModalOpen.value = true;
  await loadUltimosSignos();
  // Si ya hay toma del folio actual, precargar captura (no solo “últimos” genéricos).
  const u = ultimosSignos.value;
  if (u && Number(u.hosi_folio || 0) === Number(consulta.hosi_folio)) {
    copiarUltimosSignos();
  }
}

function closeSignosModal() {
  signosModalOpen.value = false;
}

function copiarUltimosSignos() {
  const u = ultimosSignos.value;
  if (!u) return;
  signos.pulso = String(u.pulso ?? "");
  signos.respiracion = String(u.respiracion ?? "");
  signos.tension_sis = String(u.tension_sis ?? "");
  signos.tension_dia = String(u.tension_dia ?? "");
  signos.temperatura = String(u.temperatura ?? "");
  signos.peso = String(u.peso ?? "");
  signos.estatura = String(u.estatura ?? "");
  signos.abdominal = String(u.abdominal ?? "");
  signos.saturacion = String((u as SignosRow).saturacion ?? "");
}

/** Contexto de la cita en uso (acomodo tipo siah-web). */
const citaCtx = reactive({
  hosi_folio: 0,
  ficha: "",
  codigo: "",
  empresa: 0,
  paciente: "",
  especialidad: "",
  medico: "",
  horaCita: 0,
  horaInicio: 0,
  horaTermino: 0,
  procedencia: "",
  edad: "",
  sexo: "",
  sangre: "",
  fecnac: "",
  esps_espserv: 0,
  requiere_signos: "S",
  unitrab_nota: "" as string | number,
});

/** Especialidades que el médico de sesión puede ver o elegir. */
const especialidadesMedico = computed(() => {
  if (!medicoSesionLocked.value) return especialidades.value;
  const propias = new Set(
    medicosAsignables.value
      .map((m) => Number(m.esps_espserv))
      .filter((n) => Number.isFinite(n) && n > 0),
  );
  if (!propias.size) return especialidades.value;
  return especialidades.value.filter((e) => propias.has(Number(e.esps_espserv)));
});

const agendaFiltroEspItems = computed(() => {
  const propias = especialidadesMedico.value.map((e) => ({
    label: e.espc_descrip,
    value: e.esps_espserv as number | null,
  }));
  if (medicoSesionLocked.value) {
    if (propias.length > 1) {
      return [{ label: "Mis especialidades", value: null as number | null }, ...propias];
    }
    return propias;
  }
  return [{ label: "Todas las especialidades", value: null as number | null }, ...propias];
});

function agendaEstatusFocus(estatus: unknown): "pending" | "wait" | "done" | "deferred" | "other" {
  const s = Number(estatus);
  if (s === 1) return "pending";
  if (s === 2 || s === 3) return "wait";
  if (s === 4) return "done";
  if (s === 5 || s === 9) return "deferred";
  return "other";
}

function matchesAgendaFocusTab(row: Record<string, unknown>, focus: typeof agendaFocusTab.value): boolean {
  const focusKind = agendaEstatusFocus(row.cits_estatus);
  if (focus === "all") return true;
  if (focus === "todo") return focusKind === "pending" || focusKind === "wait";
  if (focus === "wait") return focusKind === "wait";
  if (focus === "done") return focusKind === "done";
  return true;
}

const rowsBaseFiltradas = computed(() => {
  const permitidas = medicoSesionLocked.value
    ? new Set(especialidadesMedico.value.map((e) => Number(e.esps_espserv)))
    : null;
  const q = agendaBusqueda.value.trim().toLowerCase();
  return rows.value.filter((r) => {
    if (permitidas && permitidas.size && !permitidas.has(Number(r.esps_espserv))) return false;
    if (agendaFiltroEsp.value != null && Number(r.esps_espserv) !== agendaFiltroEsp.value) return false;
    if (agendaFiltroMed.value && String(r.medc_ficha || "") !== agendaFiltroMed.value) return false;
    if (agendaFiltroEstatus.value != null && Number(r.cits_estatus) !== agendaFiltroEstatus.value) return false;
    if (q) {
      const haystack = [
        r.paciente,
        r.derc_ficha,
        r.hosi_folio,
        r.especialidad,
        r.medc_nombre,
      ]
        .map((v) => String(v ?? "").toLowerCase())
        .join(" ");
      if (!haystack.includes(q)) return false;
    }
    return true;
  });
});

const rowsFiltradas = computed(() =>
  rowsBaseFiltradas.value.filter((r) => matchesAgendaFocusTab(r, agendaFocusTab.value)),
);

const agendaKpisDia = computed(() => {
  let confirmar = 0;
  let espera = 0;
  let atendido = 0;
  let todo = 0;
  for (const row of rows.value) {
    const kind = agendaEstatusFocus(row.cits_estatus);
    if (kind === "pending") {
      confirmar += 1;
      todo += 1;
    } else if (kind === "wait") {
      espera += 1;
      todo += 1;
    } else if (kind === "done") {
      atendido += 1;
    }
  }
  return {
    total: rows.value.length,
    confirmar,
    espera,
    atendido,
    todo,
  };
});

const agendaTotalPages = computed(() =>
  Math.max(1, Math.ceil(rowsFiltradas.value.length / TABLE_PAGE_SIZE)),
);

const agendaPageRows = computed(() => {
  const start = (agendaPage.value - 1) * TABLE_PAGE_SIZE;
  return rowsFiltradas.value.slice(start, start + TABLE_PAGE_SIZE);
});

const agendaPageFrom = computed(() =>
  rowsFiltradas.value.length ? (agendaPage.value - 1) * TABLE_PAGE_SIZE + 1 : 0,
);

const agendaPageTo = computed(() =>
  Math.min(agendaPage.value * TABLE_PAGE_SIZE, rowsFiltradas.value.length),
);

const agendaKpis = computed(() => agendaKpisDia.value);

const historialFiltrado = computed(() => {
  const q = historialBusqueda.value.trim().toLowerCase();
  if (!q) return historialNotas.value;
  return historialNotas.value.filter((h) =>
    [h.hosi_folio, h.cond_fechcon, h.unitrab, h.hospital]
      .map((v) => String(v ?? "").toLowerCase())
      .join(" ")
      .includes(q),
  );
});

const historialTotalPages = computed(() =>
  Math.max(1, Math.ceil(historialFiltrado.value.length / TABLE_PAGE_SIZE)),
);

const historialPageRows = computed(() => {
  const start = (historialPage.value - 1) * TABLE_PAGE_SIZE;
  return historialFiltrado.value.slice(start, start + TABLE_PAGE_SIZE);
});

const historialPageFrom = computed(() =>
  historialFiltrado.value.length ? (historialPage.value - 1) * TABLE_PAGE_SIZE + 1 : 0,
);

const historialPageTo = computed(() =>
  Math.min(historialPage.value * TABLE_PAGE_SIZE, historialFiltrado.value.length),
);

watch(
  [agendaFiltroEsp, agendaFiltroMed, agendaFiltroEstatus, agendaBusqueda, fecha, agendaFocusTab],
  () => {
    agendaPage.value = 1;
  },
);

watch(rowsFiltradas, () => {
  if (agendaPage.value > agendaTotalPages.value) {
    agendaPage.value = agendaTotalPages.value;
  }
});

watch([historialNotas, historialBusqueda], () => {
  historialPage.value = 1;
});

watch(historialTotalPages, (pages) => {
  if (historialPage.value > pages) {
    historialPage.value = pages;
  }
});

/** En sesión médica: solo sus propias fichas/especialidades. */
const medicosAsignables = computed(() => {
  if (!medicoSesionLocked.value || !medicoSesionFicha.value) return medicos.value;
  return medicos.value.filter((m) => m.medc_ficha === medicoSesionFicha.value);
});

const agendaFiltroEstatusItems = computed(() => [
  { label: "Todos los estatus", value: null as number | null },
  ...(citaEstatusCat.value.length
    ? citaEstatusCat.value
        .filter((e) => [1, 2, 3, 4].includes(e.cits_estatus))
        .map((e) => ({ label: e.etiqueta, value: e.cits_estatus as number | null }))
    : [
        { label: "Por confirmar", value: 1 as number | null },
        { label: "En espera", value: 2 as number | null },
        { label: "Atendida", value: 4 as number | null },
      ]),
]);

const edadConsultaNum = computed(() => {
  const n = Number(String(citaCtx.edad || "").replace(/[^\d.]/g, ""));
  return Number.isFinite(n) ? n : NaN;
});

const signosPercentilPeds = computed(() => {
  const edad = edadConsultaNum.value;
  if (!(edad < 18)) return null;
  const imc = calcImc(signos.peso, signos.estatura);
  return percentilImcPediatrico(imc, edad, citaCtx.sexo || "");
});

const llegadaDisabled = computed(() => {
  if (!selectedAgendaRow.value) return true;
  if (citaAtendida(selectedAgendaRow.value)) return true;
  if (Number(selectedAgendaRow.value.cits_hrllegada) > 0) return true;
  const citaFecha = String(
    selectedAgendaRow.value.citd_fechcita || fecha.value || "",
  ).slice(0, 10);
  if (citaFecha && citaFecha > hoyIso.value) return true;
  return false;
});

const revertirLlegadaDisabled = computed(() => {
  if (!selectedAgendaRow.value) return true;
  return !puedeRevertirLlegada(selectedAgendaRow.value);
});

const iniciarAtencionDisabled = computed(() => {
  if (!puedeClinica.value) return true;
  if (!selectedAgendaRow.value) return true;
  return !puedeIniciarAtencion(selectedAgendaRow.value);
});

const prefix = computed(() => {
  const p = (props.apiPrefix || "").trim();
  if (!p) return "";
  return p.startsWith("/") ? p.replace(/\/+$/, "") : `/${p.replace(/\/+$/, "")}`;
});

const patientPhotoUrl = computed(() => {
  if (!asignar.ficha.trim()) return "";
  const base = props.apiBase.replace(/\/+$/, "");
  const qs = new URLSearchParams({
    ficha: asignar.ficha.trim(),
    num_fam: String(asignar.codigo || "00").padStart(2, "0"),
    emp_clave: String(asignar.empresa ?? 0),
  });
  return `${base}${prefix.value}/derech/foto?${qs.toString()}`;
});

const consultaPhotoUrl = computed(() => {
  if (!citaCtx.ficha.trim()) return "";
  const base = props.apiBase.replace(/\/+$/, "");
  const qs = new URLSearchParams({
    ficha: citaCtx.ficha.trim(),
    num_fam: String(citaCtx.codigo || "00").padStart(2, "0"),
    emp_clave: String(citaCtx.empresa ?? 0),
  });
  return `${base}${prefix.value}/derech/foto?${qs.toString()}`;
});

const consultaStatusLine = computed(() => {
  const d = new Date(`${fecha.value.slice(0, 10)}T12:00:00`);
  const dia = DIAS_SEMANA[d.getDay()] || "";
  const mes = MESES[d.getMonth()] || "";
  const folio = consulta.hosi_folio || citaCtx.hosi_folio || "—";
  const inicio = formatHoraCelda(citaCtx.horaInicio) || formatHoraCelda(citaCtx.horaCita) || "—";
  return `${dia.charAt(0).toUpperCase()}${dia.slice(1)}, ${d.getDate()} de ${mes} de ${d.getFullYear()} · Folio ${folio} · Consulta iniciada ${inicio}`;
});

const agendaSessionContext = computed(() => {
  const medico =
    (medicoSesionLocked.value &&
      medicosAsignables.value.find((m) => m.medc_ficha === medicoSesionFicha.value)?.medc_nombre) ||
    selectedAgendaRow.value?.medico ||
    selectedAgendaRow.value?.medc_nombre ||
    props.session.username ||
    "—";
  const esp =
    especialidadesMedico.value.length === 1
      ? especialidadesMedico.value[0]?.espc_descrip
      : agendaFiltroEsp.value != null
        ? especialidadesMedico.value.find((e) => Number(e.esps_espserv) === agendaFiltroEsp.value)
            ?.espc_descrip
        : especialidadesMedico.value[0]?.espc_descrip || "—";
  return `${medico} · ${esp || "—"} · Unidad ${props.session.unitrab}`;
});

const agendaDayTitle = computed(() => {
  if (!fecha.value) return "Agenda del día";
  const d = new Date(`${fecha.value.slice(0, 10)}T12:00:00`);
  if (Number.isNaN(d.getTime())) return "Agenda del día";
  return d.toLocaleDateString("es-MX", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
});

const pacienteInitials = computed(() => {
  const parts = String(citaCtx.paciente || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return "—";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] || ""}${parts[1][0] || ""}`.toUpperCase();
});

const consultaStepHint = computed(() => {
  const hints: Record<(typeof CONSULTA_TAB_ORDER)[number], string> = {
    vitals: "Paso 1 de 3 · Registra signos y antecedentes",
    clinical: "Paso 2 de 3 · Redacta la nota clínica",
    diagnostic: "Paso 3 de 3 · Agrega diagnósticos y procedimientos",
    history: "Historial de notas del paciente",
  };
  return hints[consultaUiTab.value];
});

function setAgendaFocusTab(value: typeof agendaFocusTab.value) {
  agendaFocusTab.value = value;
  agendaPage.value = 1;
}

function moveAgendaDay(delta: number) {
  const d = new Date(`${fecha.value.slice(0, 10)}T12:00:00`);
  d.setDate(d.getDate() + delta);
  fecha.value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  calMonth.value = fecha.value.slice(0, 7);
  agendaPage.value = 1;
  void load();
}

function goAgendaToday() {
  const d = new Date();
  fecha.value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  calMonth.value = fecha.value.slice(0, 7);
  agendaPage.value = 1;
  void load();
}

function openAgendaDrawer(row: Record<string, unknown>) {
  selectAgendaRow(row);
  agendaDrawerOpen.value = true;
}

function closeAgendaDrawer() {
  agendaDrawerOpen.value = false;
}

function onAgendaFechaChange(iso: string | null) {
  if (!iso) return;
  fecha.value = iso.slice(0, 10);
  calMonth.value = fecha.value.slice(0, 7);
  agendaPage.value = 1;
  void load();
}

function switchConsultaTab(key: (typeof CONSULTA_TAB_ORDER)[number]) {
  consultaUiTab.value = key;
}

function moveConsultaTab(delta: number) {
  const i = CONSULTA_TAB_ORDER.indexOf(consultaUiTab.value);
  const next = Math.max(0, Math.min(CONSULTA_TAB_ORDER.length - 1, i + delta));
  consultaUiTab.value = CONSULTA_TAB_ORDER[next];
}

function revealConsultaErrorTab() {
  if (consultaBloqueadaSinSignos.value) {
    switchConsultaTab("vitals");
    return;
  }
  if (!soapCompleto.value || !String(consulta.motivoConsulta || "").trim()) {
    switchConsultaTab("clinical");
    return;
  }
  if (!diagnosticoCapturado.value || !diagnosticoCalificado.value) {
    switchConsultaTab("diagnostic");
  }
}

function agendaPrimaryAction(row: Record<string, unknown>): {
  label: string;
  primary: boolean;
  kind: "attend" | "arrival" | "note" | "none";
} {
  if (citaAtendida(row)) return { label: "Ver nota", primary: false, kind: "note" };
  if (puedeIniciarAtencion(row)) {
    return { label: "Iniciar atención →", primary: true, kind: "attend" };
  }
  if (!citaYaLlego(row)) {
    return { label: "Registrar llegada", primary: true, kind: "arrival" };
  }
  return { label: "", primary: false, kind: "none" };
}

function calcEdad(fecnac: string): string {
  if (!fecnac) return "";
  const d = new Date(fecnac.slice(0, 10));
  if (Number.isNaN(d.getTime())) return "";
  const today = new Date();
  let age = today.getFullYear() - d.getFullYear();
  const m = today.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < d.getDate())) age -= 1;
  return age >= 0 ? String(age) : "";
}

function formatHora(hhmm: unknown): string {
  const n = Number(hhmm);
  if (!Number.isFinite(n)) return "";
  const h = Math.floor(n / 100);
  const m = n % 100;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")} HRS.`;
}

function formatHoraCelda(hhmm: unknown): string {
  const n = Number(hhmm);
  if (!Number.isFinite(n)) return "";
  const h = Math.floor(n / 100);
  const m = n % 100;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function formatAgendaTitulo(iso: string): string {
  if (!iso) return "AGENDA MÉDICA";
  const d = new Date(`${iso.slice(0, 10)}T12:00:00`);
  if (Number.isNaN(d.getTime())) return "AGENDA MÉDICA";
  const dia = DIAS_SEMANA[d.getDay()] || "";
  const mes = MESES[d.getMonth()] || "";
  return `AGENDA DE ${dia.toUpperCase()}, ${d.getDate()} DE ${mes.toUpperCase()} DE ${d.getFullYear()}`;
}

function formatCalMonthLabel(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  if (!y || !m) return ym;
  return `${MESES[m - 1] || ""} de ${y}`;
}

function selectedAgendaFolio(row: Record<string, unknown>): boolean {
  return Number(selectedAgendaRow.value?.hosi_folio) === Number(row.hosi_folio);
}

function agendaRowClasses(row: Record<string, unknown>): string[] {
  return [
    citaStatusClass(row.cits_estatus),
    "siah-agenda-row",
    selectedAgendaFolio(row) ? "siah-agenda-row--picked" : "",
  ];
}

const calWeeks = computed(() => {
  const [y, m] = calMonth.value.split("-").map(Number);
  if (!y || !m) return [] as (number | null)[][];
  const first = new Date(y, m - 1, 1);
  const daysInMonth = new Date(y, m, 0).getDate();
  const weeks: (number | null)[][] = [];
  let week: (number | null)[] = Array(first.getDay()).fill(null);
  for (let day = 1; day <= daysInMonth; day += 1) {
    week.push(day);
    if (week.length === 7) {
      weeks.push(week);
      week = [];
    }
  }
  if (week.length) weeks.push([...week, ...Array(7 - week.length).fill(null)]);
  return weeks;
});

const selectedCalDay = computed(() => Number(fecha.value.slice(8, 10)) || 0);

const tiempoEsperaProm = computed(() => {
  const mins: number[] = [];
  for (const row of rows.value) {
    const cita = Number(row.citn_hrcita);
    const llegada = Number(row.cits_hrllegada);
    if (!Number.isFinite(cita) || !Number.isFinite(llegada) || llegada <= 0) continue;
    const citaMin = Math.floor(cita / 100) * 60 + (cita % 100);
    const llegadaMin = Math.floor(llegada / 100) * 60 + (llegada % 100);
    if (llegadaMin >= citaMin) mins.push(llegadaMin - citaMin);
  }
  if (!mins.length) return "00:00";
  const avg = Math.round(mins.reduce((a, b) => a + b, 0) / mins.length);
  return `${String(Math.floor(avg / 60)).padStart(2, "0")}:${String(avg % 60).padStart(2, "0")}`;
});

const tiempoConsultaProm = computed(() => "00:00");

function shiftCalMonth(delta: number) {
  const [y, m] = calMonth.value.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  calMonth.value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function pickCalendarDay(day: number | null) {
  if (!day) return;
  const [y, m] = calMonth.value.split("-").map(Number);
  const iso = `${y}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  fecha.value = iso;
  if (tab.value === "asignar" && iso >= hoyIso.value) {
    asignar.fecha = iso;
  }
  void load();
}

function isCalendarDaySelected(day: number | null): boolean {
  if (!day) return false;
  const [y, m] = calMonth.value.split("-").map(Number);
  const iso = `${y}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return iso === fecha.value.slice(0, 10);
}

function selectAgendaRow(row: Record<string, unknown>) {
  selectedAgendaRow.value = row;
  selectCita(row);
}

function openConsultaFromAgenda(row: Record<string, unknown>) {
  selectAgendaRow(row);
  agendaDrawerOpen.value = false;
  if (!citaYaLlego(row) && !citaAtendida(row)) {
    error.value = "Registre la llegada del paciente antes de iniciar la atención médica";
    okMsg.value = "";
    return;
  }
  consultaOkLocal.value = false;
  consultaUiTab.value = "vitals";
  // Solo cambia el tab: el watch(tab) dispara loadConsultaContext una vez.
  // Si ya estábamos en consulta, forzar recarga aquí.
  const alreadyOnConsulta = tab.value === "consulta";
  tab.value = "consulta";
  if (alreadyOnConsulta) {
    void loadConsultaContext(true);
  }
}

function imprimirAgenda() {
  if (!rows.value.length) {
    error.value = "No hay citas para imprimir en esta fecha";
    return;
  }
  const win = window.open("", "_blank", "noopener,noreferrer,width=960,height=720");
  if (!win) {
    error.value = "El navegador bloqueó la ventana de impresión";
    return;
  }
  const rowsHtml = rows.value
    .map(
      (r, i) =>
        `<tr>
          <td>${i + 1}</td>
          <td>${r.hosi_folio ?? ""}</td>
          <td>${formatHoraCelda(r.citn_hrcita)}</td>
          <td>${formatHoraCelda(r.cits_hrllegada) || "—"}</td>
          <td>${r.derc_ficha ?? ""}</td>
          <td>${r.paciente ?? ""}</td>
          <td>${r.especialidad ?? "—"}</td>
        </tr>`,
    )
    .join("");
  win.document.write(`<!doctype html><html><head><title>Agenda médica ${fecha.value}</title>
    <style>body{font-family:sans-serif;padding:24px}table{width:100%;border-collapse:collapse;font-size:12px}
    th,td{border:1px solid #ccc;padding:6px 8px;text-align:left}th{background:#eee}</style></head>
    <body><h2>Agenda médica · ${fecha.value}</h2>
    <table><thead><tr><th>No</th><th>Folio</th><th>Cita</th><th>Llegó</th><th>Ficha</th><th>Paciente</th><th>Especialidad</th></tr></thead>
    <tbody>${rowsHtml}</tbody></table></body></html>`);
  win.document.close();
  win.focus();
  win.print();
}

function openExpedienteFromAgenda(row: Record<string, unknown>) {
  emit("openExpediente", {
    ficha: String(row.derc_ficha || ""),
    codigo: String(row.derc_codigo || "00"),
    empresa: Number(row.emp_clave ?? row.ders_empresa ?? 0),
    hosi_folio: Number(row.hosi_folio),
  });
}

function requireSelectedAgenda(action: string): Record<string, unknown> | null {
  if (!selectedAgendaRow.value) {
    error.value = `Seleccione una cita en la agenda para ${action}`;
    return null;
  }
  return selectedAgendaRow.value;
}

async function llegadaSelected() {
  const row = requireSelectedAgenda("registrar llegada");
  if (!row) return;
  if (citaAtendida(row)) {
    error.value = "La cita ya está atendida; no se puede registrar llegada";
    return;
  }
  if (Number(row.cits_hrllegada) > 0) {
    error.value = "La llegada ya fue registrada para esta cita";
    return;
  }
  await llegada(Number(row.hosi_folio));
}

async function revertirLlegadaSelected() {
  const row = requireSelectedAgenda("revertir llegada");
  if (!row) return;
  if (!puedeRevertirLlegada(row)) {
    error.value = "No hay llegada que revertir, o la cita ya está atendida";
    return;
  }
  loading.value = true;
  error.value = "";
  try {
    const res = await post<{ mensaje: string }>("/sub/atmed/llegada/revertir", {
      ...props.session,
      hosi_folio: Number(row.hosi_folio),
    });
    okMsg.value = res.mensaje || "Llegada revertida";
    await load();
  } catch (e) {
    error.value = e instanceof Error ? e.message : "Error al revertir llegada";
  } finally {
    loading.value = false;
  }
}

function confirmarCitaSelected() {
  const row = requireSelectedAgenda("confirmar");
  if (!row) return;
  if (citaAtendida(row)) {
    error.value = "La cita ya está atendida; no se puede cambiar el estatus";
    return;
  }
  if (Number(row.cits_estatus) !== 1) {
    okMsg.value = `La cita ${row.hosi_folio} ya está confirmada o en otro estatus`;
    return;
  }
  okMsg.value = `Cita ${row.hosi_folio} en Por confirmar (estatus inicial)`;
}

async function diferirCitaSelected() {
  const row = requireSelectedAgenda("diferir");
  if (!row) return;
  if (citaAtendida(row)) {
    error.value = "La cita ya está atendida; no se puede diferir";
    return;
  }
  loading.value = true;
  error.value = "";
  try {
    const res = await post<{ mensaje: string }>("/sub/atmed/diferir", {
      ...props.session,
      hosi_folio: Number(row.hosi_folio),
    });
    okMsg.value = res.mensaje || `Cita ${row.hosi_folio} diferida`;
    await load();
  } catch (e) {
    error.value = e instanceof Error ? e.message : "Error al diferir cita";
  } finally {
    loading.value = false;
  }
}

function formatFechaDisplay(iso: string): string {
  if (!iso) return "";
  const [y, mo, d] = iso.slice(0, 10).split("-");
  if (!y || !mo || !d) return iso;
  return `${d}/${mo}/${y}`;
}

function formatCitaHoraShort(hhmm: unknown): string {
  const n = Number(hhmm);
  if (!Number.isFinite(n)) return "";
  const h = Math.floor(n / 100);
  const m = n % 100;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")} h`;
}

function citaStatusClass(estatus: unknown): string {
  const s = Number(estatus);
  if (s === 1) return "siah-agenda-row--confirmar";
  if (s === 2 || s === 3) return "siah-agenda-row--espera";
  if (s === 4) return "siah-agenda-row--atendido";
  if (s === 5 || s === 9) return "siah-agenda-row--diferido";
  return "siah-agenda-row--diferido";
}

function citaStatusBadgeClass(estatus: unknown): string {
  const s = Number(estatus);
  if (s === 1) return "siah-badge siah-badge--pending";
  if (s === 2 || s === 3) return "siah-badge siah-badge--wait";
  if (s === 4) return "siah-badge siah-badge--done";
  if (s === 5 || s === 9) return "siah-badge siah-badge--deferred";
  return "siah-badge siah-badge--absent";
}

function citaStatusLabel(estatus: unknown): string {
  const s = Number(estatus);
  const fromCat = citaEstatusCat.value.find((e) => Number(e.cits_estatus) === s)?.etiqueta;
  if (fromCat) return String(fromCat).toUpperCase();
  if (s === 1) return "POR CONFIRMAR";
  if (s === 2 || s === 3) return "EN ESPERA";
  if (s === 4) return "ATENDIDO";
  if (s === 5 || s === 9) return "DIFERIDO";
  return "SIN ESTATUS";
}

function normalizeProcedencia(raw: unknown): { label: string; className: string } | null {
  const value = String(raw || "").trim().toUpperCase();
  if (!value) return null;
  if (value.includes("FOR") || value === "F") {
    return { label: "FORÁNEO", className: "siah-badge siah-badge--foreign" };
  }
  if (value.includes("TRAM") || value.includes("ADMIN")) {
    return { label: "TRÁMITE ADMINISTRATIVO", className: "siah-badge siah-badge--admin" };
  }
  if (value.includes("LOC") || value === "L") {
    return { label: "LOCAL", className: "siah-badge siah-badge--local" };
  }
  return { label: value, className: "siah-badge siah-badge--local" };
}

function procedenciaBadgeClass(row: Record<string, unknown>): string {
  return normalizeProcedencia(row.procedencia || row.derc_procedencia || row.ders_locfor)?.className || "";
}

function procedenciaBadgeLabel(row: Record<string, unknown>): string {
  return normalizeProcedencia(row.procedencia || row.derc_procedencia || row.ders_locfor)?.label || "";
}

function calendarDayHasCitas(day: number | null): boolean {
  if (!day) return false;
  const [y, m] = calMonth.value.split("-").map(Number);
  const iso = `${y}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return iso === fecha.value.slice(0, 10) && rows.value.length > 0;
}

function clearPaciente() {
  paciente.nombre = "";
  paciente.ct = "";
  paciente.depto = "";
  paciente.org = "";
  paciente.edad = "";
  paciente.sx = "";
  paciente.rc = "";
  paciente.uma = "";
  paciente.umaDescri = "";
  paciente.procedencia = "";
  paciente.vigencia = "";
  paciente.estatusVigencia = "";
  photoFailed.value = false;
}

async function loadPaciente() {
  if (!asignar.ficha.trim()) {
    buscarHint.value = "Ingrese los datos del paciente para buscarlo en el sistema.";
    clearPaciente();
    pacienteBuscado.value = false;
    citasPaciente.value = [];
    beneficiariosFicha.value = [];
    return;
  }
  paciente.loading = true;
  error.value = "";
  buscarHint.value = "";
  try {
    await loadBeneficiariosPorFicha();
    const data = await post<{ ok: boolean; record: Record<string, unknown> }>("/derech/detail", {
      ...props.session,
      ficha: asignar.ficha.trim(),
      codigo: (asignar.codigo || "00").trim(),
      empresa: asignar.empresa,
    });
    const r = data.record || {};
    paciente.nombre = [r.derc_nombre, r.derc_appaterno, r.derc_apmaterno]
      .map((v) => String(v || "").trim())
      .filter(Boolean)
      .join(" ");
    paciente.ct = String(r.cens_clave || r.ct_desc || "");
    paciente.depto = String(r.deps_clave || r.depto_desc || "");
    paciente.org = String(r.orgs_clave || "");
    paciente.sx = String(r.derc_sexo || "");
    paciente.rc = String(r.derc_regcontrac || "");
    paciente.uma = String(r.unis_unimed || "");
    paciente.umaDescri = String(r.uma_desc || "");
    paciente.procedencia = String(r.ders_locfor || "");
    paciente.vigencia = String(r.derd_vigencia || "").slice(0, 10);
    paciente.estatusVigencia = String(r.estatus_desc || r.ders_estatus || "").replace(
      /VIEGENTE/gi,
      "VIGENTE",
    );
    paciente.edad = calcEdad(String(r.derd_fecnac || ""));
    if (r.ders_empresa != null && r.ders_empresa !== "") {
      asignar.empresa = Number(r.ders_empresa);
    }
    photoFailed.value = false;
    pacienteBuscado.value = true;
    asignarOkFolio.value = "";
    await loadCitasPaciente();
  } catch (e) {
    clearPaciente();
    pacienteBuscado.value = false;
    citasPaciente.value = [];
    error.value = e instanceof Error ? e.message : "Paciente no encontrado";
  } finally {
    paciente.loading = false;
  }
}

async function loadCitasPaciente() {
  if (!asignar.ficha.trim()) {
    citasPaciente.value = [];
    return;
  }
  try {
    const data = await post<{ rows: Record<string, unknown>[] }>("/sub/atmed/citas/paciente", {
      ...props.session,
      ficha: asignar.ficha.trim(),
      codigo: (asignar.codigo || "00").trim(),
      fecha: asignar.fecha,
    });
    citasPaciente.value = data.rows || [];
  } catch (e) {
    citasPaciente.value = [];
    error.value = e instanceof Error ? e.message : "Error cargando citas del paciente";
  }
}

function limpiarAsignar() {
  asignar.ficha = "";
  asignar.codigo = "00";
  asignar.empresa = 0;
  asignar.folioConsulta = "";
  asignar.observaciones = "";
  if (!asignar.fecha || asignar.fecha < hoyIso.value) {
    asignar.fecha = hoyIso.value;
  }
  clearPaciente();
  citasPaciente.value = [];
  beneficiariosFicha.value = [];
  pacienteBuscado.value = false;
  asignarOkFolio.value = "";
  buscarHint.value = "Ingrese los datos del paciente para buscarlo en el sistema.";
  error.value = "";
  okMsg.value = "";
}

function partialClearAsignar() {
  asignar.observaciones = "";
  asignar.ficha = "";
  asignar.codigo = "00";
  asignar.empresa = 0;
  asignar.folioConsulta = "";
  clearPaciente();
  citasPaciente.value = [];
  beneficiariosFicha.value = [];
  pacienteBuscado.value = false;
  buscarHint.value = "Ingrese los datos del paciente para buscarlo en el sistema.";
}

async function loadAgendaAsignar() {
  fecha.value = asignar.fecha;
  agendaAsignarPage.value = 1;
  await load();
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const base = props.apiBase.replace(/\/+$/, "");
  const url = `${base}${prefix.value}${path.startsWith("/") ? path : `/${path}`}`;
  const outbound =
    body && typeof body === "object" && !Array.isArray(body)
      ? Object.fromEntries(
          Object.entries(body as Record<string, unknown>).filter(
            ([k]) =>
              !["bearer", "password", "usuario", "pg_schema", "tipo_usuario", "unitrab", "rol"].includes(
                k,
              ),
          ),
        )
      : body;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(outbound),
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

async function loadEmpresasCat() {
  try {
    const data = await post<{ rows: Record<string, unknown>[] }>("/sub/atmed/empresas", props.session);
    empresasCat.value = (data.rows || []).map((r) => ({
      emp_clave: Number(r.emp_clave ?? 0),
      emp_descrip: String(r.emp_descrip || r.emp_clave || "0"),
    }));
    if (!empresasCat.value.length) {
      empresasCat.value = [{ emp_clave: 0, emp_descrip: "0 — Default" }];
    }
  } catch {
    empresasCat.value = [{ emp_clave: 0, emp_descrip: "0 — Default" }];
  }
}

async function loadBeneficiariosPorFicha() {
  const ficha = asignar.ficha.trim();
  if (!ficha) {
    beneficiariosFicha.value = [];
    return;
  }
  try {
    const data = await post<{ rows: Record<string, unknown>[] }>("/derech/list", {
      ...props.session,
      ficha,
      limit: 50,
      page: 1,
    });
    beneficiariosFicha.value = (data.rows || []).map((r) => ({
      derc_codigo: String(r.derc_codigo || "00").padStart(2, "0"),
      ders_empresa: String(r.ders_empresa ?? 0),
      nombre_completo: String(r.nombre_completo || "").trim(),
    }));
    if (beneficiariosFicha.value.length === 1) {
      asignar.codigo = beneficiariosFicha.value[0].derc_codigo;
      asignar.empresa = Number(beneficiariosFicha.value[0].ders_empresa);
    } else if (beneficiariosFicha.value.length > 1) {
      const hit = beneficiariosFicha.value.find(
        (b) =>
          b.derc_codigo === String(asignar.codigo || "00").padStart(2, "0") &&
          Number(b.ders_empresa) === Number(asignar.empresa),
      );
      if (!hit) {
        asignar.codigo = beneficiariosFicha.value[0].derc_codigo;
        asignar.empresa = Number(beneficiariosFicha.value[0].ders_empresa);
      }
    }
  } catch {
    beneficiariosFicha.value = [];
  }
}

async function loadCatalogos() {
  try {
    const [esp, med, ses, est] = await Promise.all([
      post<{ rows: Record<string, unknown>[] }>("/sub/atmed/especialidades", props.session),
      post<{ rows: Record<string, unknown>[] }>("/sub/atmed/medicos", {
        ...props.session,
        // Sin filtro: la especialidad la define el médico seleccionado
        esps_espserv: null,
      }),
      post<{ record?: Record<string, unknown> }>("/sub/atmed/medico-sesion", props.session).catch(
        () => ({ record: {} }),
      ),
      post<{ rows?: Record<string, unknown>[] }>("/sub/atmed/cita-estatus", props.session).catch(
        () => ({ rows: [] }),
      ),
    ]);
    especialidades.value = (esp.rows || []).map((r) => ({
      esps_espserv: Number(r.esps_espserv),
      espc_descrip: String(r.espc_descrip || ""),
      requiere_signos: String(r.requiere_signos || "S").toUpperCase() === "N" ? "N" : "S",
    }));
    medicos.value = (med.rows || []).map((r) => ({
      medc_ficha: String(r.medc_ficha || ""),
      medc_codigo: String(r.medc_codigo || "00"),
      medc_nombre: String(r.medc_nombre || ""),
      esps_espserv: Number(r.esps_espserv),
      espc_descrip: String(r.espc_descrip || ""),
    }));
    citaEstatusCat.value = (est.rows || []).map((r) => ({
      cits_estatus: Number(r.cits_estatus),
      etiqueta: String(r.etiqueta || r.cits_estatus),
    }));
    const sesRec = ses.record || {};
    if (sesRec.medc_ficha && sesRec.esps_espserv != null) {
      asignar.medc_ficha = String(sesRec.medc_ficha);
      asignar.medc_codigo = String(sesRec.medc_codigo || "00");
      asignar.esps_espserv = Number(sesRec.esps_espserv);
      asignar.medicoKey = `${asignar.medc_ficha}|${asignar.medc_codigo}|${asignar.esps_espserv}`;
      if (!esRecepcionista.value) {
        medicoSesionLocked.value = true;
        medicoSesionFicha.value = asignar.medc_ficha;
        agendaFiltroMed.value = asignar.medc_ficha;
        agendaFiltroEsp.value = Number(sesRec.esps_espserv);
      }
    } else {
      medicoSesionLocked.value = false;
      medicoSesionFicha.value = "";
    }
    const currentKey = asignar.medicoKey;
    const stillThere = medicos.value.some((m) => medicoOptionKey(m) === currentKey);
    if (medicos.value.length && !stillThere) {
      const prefer =
        medicos.value.find((m) => m.medc_ficha === asignar.medc_ficha) || medicos.value[0];
      applyMedicoKey(medicoOptionKey(prefer));
    } else if (stillThere) {
      applyMedicoKey(currentKey);
    }
    await loadHoras();
  } catch (e) {
    error.value = e instanceof Error ? e.message : "Error catálogos";
  }
}

async function onMedicoChange() {
  applyMedicoKey(asignar.medicoKey);
  await loadHoras();
}

async function loadHoras() {
  const data = await post<{ rows: { hora: number; label: string }[] }>("/sub/atmed/horas", {
    ...props.session,
    medc_ficha: asignar.medc_ficha,
    medc_codigo: asignar.medc_codigo,
    fecha: asignar.fecha,
    esps_espserv: asignar.esps_espserv,
  });
  horas.value = data.rows || [];
  if (horas.value.length && !horas.value.find((h) => h.hora === asignar.hora)) {
    asignar.hora = horas.value[0].hora;
  }
  if (!horas.value.length) {
    asignar.hora = 0;
  }
}

async function llegada(folio: number) {
  loading.value = true;
  try {
    const res = await post<{ mensaje?: string; record?: Record<string, unknown> }>("/sub/atmed/llegada", {
      ...props.session,
      hosi_folio: folio,
    });
    okMsg.value = res.mensaje || "Llegada registrada";
    if (res.record?.vigencia_ok === false && res.record?.vigencia_aviso) {
      error.value = String(res.record.vigencia_aviso);
    }
    await load();
    const updated = rows.value.find((r) => Number(r.hosi_folio) === folio);
    if (updated) selectedAgendaRow.value = updated;
  } catch (e) {
    error.value = e instanceof Error ? e.message : "Error registrando llegada";
  } finally {
    loading.value = false;
  }
}

async function doAsignar() {
  if (asignando.value) return;
  error.value = "";
  okMsg.value = "";
  if (!pacienteBuscado.value) {
    buscarHint.value = "Ingrese los datos del paciente para buscarlo en el sistema.";
    return;
  }
  if (citaDuplicadaDia.value) {
    error.value =
      citaDuplicadaMsg.value
        ? `El paciente ya tiene una cita el mismo día: ${citaDuplicadaMsg.value}. No se permite otra cita hasta definir la regla de negocio.`
        : "El paciente ya tiene una cita activa el mismo día.";
    return;
  }
  const ficha = asignar.ficha.trim();
  const codigo = (asignar.codigo || "00").trim();
  if (!ficha || !paciente.nombre) {
    buscarHint.value = "Ingrese los datos del paciente para buscarlo en el sistema.";
    return;
  }
  asignando.value = true;
  loading.value = true;
  try {
    const res = await post<{ mensaje: string; record?: { hosi_folio: number } }>("/sub/atmed/asignar", {
      ...props.session,
      ficha,
      codigo,
      empresa: asignar.empresa,
      esps_espserv: asignar.esps_espserv,
      medc_ficha: asignar.medc_ficha,
      medc_codigo: asignar.medc_codigo,
      fecha: asignar.fecha,
      hora: asignar.hora,
      mensaje: asignar.observaciones,
    });
    const folio = res.record?.hosi_folio != null ? String(res.record.hosi_folio) : "";
    asignarOkFolio.value = folio;
    okMsg.value = folio
      ? `Cita registrada. Folio de cita médica: ${folio}`
      : res.mensaje || "Cita registrada.";
    partialClearAsignar();
    fecha.value = asignar.fecha;
    await load();
    await loadHoras();
  } catch (e) {
    error.value = e instanceof Error ? e.message : "Error al asignar";
  } finally {
    loading.value = false;
    asignando.value = false;
  }
}

function selectCita(row: Record<string, unknown>) {
  const folio = Number(row.hosi_folio);
  consulta.hosi_folio = folio;
  signos.hosi_folio = folio;
  citaCtx.hosi_folio = folio;
  citaCtx.ficha = String(row.derc_ficha || "");
  citaCtx.codigo = String(row.derc_codigo || "00");
  citaCtx.empresa = Number(row.emp_clave ?? 0);
  citaCtx.paciente = String(row.paciente || "");
  citaCtx.especialidad = String(row.especialidad || "");
  citaCtx.medico = String(row.medico || "");
  citaCtx.horaCita = Number(row.citn_hrcita || 0);
  citaCtx.horaInicio = Number(row.cits_hrllegada || 0);
  citaCtx.horaTermino = 0;
  citaCtx.esps_espserv = Number(row.esps_espserv || 0);
  citaCtx.unitrab_nota = props.session.unitrab;
  if (row.derd_fecnac) {
    citaCtx.fecnac = String(row.derd_fecnac).slice(0, 10);
  }
  const flag = String(row.requiere_signos || "").toUpperCase();
  if (flag === "N" || flag === "S") {
    citaCtx.requiere_signos = flag;
  } else {
    const esp = especialidades.value.find((e) => e.esps_espserv === citaCtx.esps_espserv);
    citaCtx.requiere_signos = esp?.requiere_signos === "N" ? "N" : "S";
  }
  // Estatus 4 = atendida / nota grabada (legacy).
  notaBloqueada.value = Number(row.cits_estatus) === 4;
  consultaOkLocal.value = notaBloqueada.value;
  if (consultaLoadedFolio.value !== folio) {
    // Evitar arrastrar dx / procedimientos / SOAP de otra consulta.
    consulta.sintomas = "";
    consulta.objetivo = "";
    consulta.analisis = "";
    consulta.plan = "";
    consulta.diai_clacie1 = "";
    consulta.diai_clacie2 = "";
    consulta.diai_clacie3 = "";
    consulta.diai_clacie4 = "";
    consulta.diai_clacie5 = "";
    consulta.motivoCie10 = "";
    consulta.motivoConsulta = "";
    consulta.diagnosticoTexto = "";
    consulta.diagnosticoTexto2 = "";
    consulta.diagnosticoTexto3 = "";
    consulta.diagnosticoTexto4 = "";
    consulta.diagnosticoTexto5 = "";
    consulta.enfermedadPrimeraVez = false;
    consulta.enfermedadSub = false;
    consulta.conn_tipocon = "";
    tipoconMotivo.value = "";
    dxSlotsVisible.value = 1;
    procedimientosSel.value = [];
    procQ.value = "";
    consultaLoadedFolio.value = 0;
  }
}

async function loadNotaGrabada() {
  if (!citaCtx.hosi_folio) return;
  try {
    const res = await post<{ record: Record<string, unknown> }>("/sub/atmed/consulta/detalle", {
      ...props.session,
      hosi_folio: citaCtx.hosi_folio,
    });
    const r = res.record || {};
    if (!r.grabada) {
      if (!notaBloqueada.value) return;
      // Estatus 4 sin fila: igual bloquear escritura nueva.
      return;
    }
    notaBloqueada.value = true;
    consulta.sintomas = String(r.sintomas || "");
    consulta.objetivo = String(r.objetivo || "");
    consulta.analisis = String(r.analisis || "");
    consulta.plan = String(r.plan || "");
    consulta.diai_clacie1 = String(r.diai_clacie1 || "");
    consulta.diai_clacie2 = String(r.diai_clacie2 || "");
    consulta.diai_clacie3 = String(r.diai_clacie3 || "");
    consulta.diai_clacie4 = String(r.diai_clacie4 || "");
    consulta.diai_clacie5 = String(r.diai_clacie5 || "");
    // pg_schema lo inyecta el proxy; no guardarlo en el cliente
    if (r.unitrab != null) citaCtx.unitrab_nota = r.unitrab as string | number;
    const tipocon = String(r.conn_tipocon || "").toUpperCase().slice(0, 1);
    consulta.conn_tipocon = tipocon === "P" || tipocon === "S" ? tipocon : "";
    consulta.enfermedadPrimeraVez = tipocon === "P";
    consulta.enfermedadSub = tipocon === "S";
    dxSlotsVisible.value =
      [
        consulta.diai_clacie1,
        consulta.diai_clacie2,
        consulta.diai_clacie3,
        consulta.diai_clacie4,
        consulta.diai_clacie5,
      ].filter(Boolean).length || 1;
  } catch {
    /* precarga sigue siendo usable */
  }
}

/** Evita doble fetch si agenda + watch(tab) disparan load a la vez. */
let consultaContextInflight: Promise<void> | null = null;
let consultaContextInflightKey = "";

async function loadConsultaContext(force = false) {
  if (!citaCtx.ficha) return;
  if (!force && consultaLoadedFolio.value === citaCtx.hosi_folio && citaCtx.hosi_folio) return;

  const key = [
    Number(citaCtx.hosi_folio || 0),
    String(citaCtx.ficha || "").trim(),
    String(citaCtx.codigo || "00").trim(),
    Number(citaCtx.empresa || 0),
  ].join("|");

  if (consultaContextInflight && consultaContextInflightKey === key) {
    return consultaContextInflight;
  }

  const run = (async () => {
    consultaPhotoFailed.value = false;
    try {
      const [det, pre] = await Promise.all([
        post<{ ok: boolean; record: Record<string, unknown> }>("/derech/detail", {
          ...props.session,
          ficha: citaCtx.ficha.trim(),
          codigo: (citaCtx.codigo || "00").trim(),
          empresa: citaCtx.empresa,
        }),
        post<{ success?: boolean; data?: Record<string, unknown> }>("/ece/nota/ce/precarga", {
          ...props.session,
          ficha: citaCtx.ficha.trim(),
          idCodificacion: (citaCtx.codigo || "00").trim(),
          idEmpresa: citaCtx.empresa,
          idEspecialidad: citaCtx.esps_espserv || undefined,
        }).catch(() => ({ data: {} })),
      ]);

      const r = det.record || {};
      citaCtx.paciente =
        citaCtx.paciente ||
        [r.derc_nombre, r.derc_appaterno, r.derc_apmaterno]
          .map((v) => String(v || "").trim())
          .filter(Boolean)
          .join(" ");
      citaCtx.procedencia = String(r.ders_locfor || citaCtx.procedencia || "");
      citaCtx.sexo = String(r.derc_sexo || citaCtx.sexo || "");
      citaCtx.edad = calcEdad(String(r.derd_fecnac || ""))
        ? `${calcEdad(String(r.derd_fecnac || ""))} AÑOS`
        : citaCtx.edad;
      if (r.derd_fecnac) citaCtx.fecnac = String(r.derd_fecnac).slice(0, 10);
      const tipoSangre = String(r.derc_tiposangre || r.tiposangre || r.derc_sangre || "").trim();
      const rh = String(r.derc_rh || r.rh || "").trim();
      if (tipoSangre || rh) {
        citaCtx.sangre = `${tipoSangre}${rh}`.trim() || "—";
      }
      if (r.ders_empresa != null && r.ders_empresa !== "") {
        citaCtx.empresa = Number(r.ders_empresa);
      }

      const preData = pre.data || {};
      if (preData.edad) citaCtx.edad = String(preData.edad);
      if (preData.sexo) citaCtx.sexo = String(preData.sexo).startsWith("MASC") ? "M" : citaCtx.sexo;

      await loadNotaGrabada();
      await loadHistorialPaciente();
      if (!notaBloqueada.value) {
        await aplicarTipoconSugerido();
        // Prellenado subjetivo editable (no copia nota anterior)
        if (!consulta.sintomas.trim()) {
          const bits = [
            citaCtx.sexo === "M" ? "Paciente masculino" : citaCtx.sexo === "F" ? "Paciente femenino" : "",
            citaCtx.edad ? `de ${citaCtx.edad.replace(/años/i, "").trim()} años` : "",
            citaCtx.fecnac ? `(nac. ${citaCtx.fecnac})` : "",
          ].filter(Boolean);
          if (bits.length) {
            consulta.sintomas = `${bits.join(" ")}. Motivo de consulta: `;
          }
        }
      }

      if (!notaBloqueada.value) {
        consulta.sintomas = String(preData.sintomas || consulta.sintomas || "");
        const cr = (preData.cronicos as Record<string, boolean>) || {};
        censoBase.diabetes = Boolean(cr.diabetes);
        censoBase.hipertension = Boolean(cr.hipertension);
        censoBase.obesidad = Boolean(cr.obesidad);
        notaCronica.diabetes = cr.diabetes ? "positivo" : "negativo";
        notaCronica.hipertension = cr.hipertension ? "positivo" : "negativo";
        notaCronica.obesidad = cr.obesidad ? "positivo" : "negativo";
        const alergiasTxt = String(preData.alergias || preData.analisis || "");
        notaCronica.alergias =
          preData.alergiasRegistradas === true ||
          (alergiasTxt && !alergiasTxt.toUpperCase().includes("NO REGISTRADAS"))
            ? "positivo"
            : "negativo";
        if (notaCronica.alergias === "positivo") {
          loadAlergiasListaFromTexto(alergiasTxt);
          void loadAlergiasCatalogo("");
        } else {
          alergiasLista.value = [];
          syncingAlergiaCatalogoSel.value = true;
          alergiaCatalogoSel.value = [];
          syncingAlergiaCatalogoSel.value = false;
          alergiaOtroTexto.value = "";
          notaCronica.alergiasDetalle = "ALERGIAS NO REGISTRADAS";
        }
        antecedentesVisitados.value = true;
        if (!consulta.analisis.trim() && alergiasTxt) {
          consulta.analisis = alergiasTxt;
        }
        syncCronicosEnAnalisis();
      } else {
        antecedentesVisitados.value = true;
      }
      consultaLoadedFolio.value = citaCtx.hosi_folio;
      await loadUltimosSignos();
      if (!notaBloqueada.value && ultimosSignos.value && !SIGNOS_PLAN_RE.test(consulta.plan || "")) {
        syncSignosEnPlan(formatSignosResumenLinea(ultimosSignos.value));
      }
      await loadRecetasConsulta();
      // Host: habilitar/deshabilitar botón Solicitudes (Forma 11-5).
      emit("consultaGuardada", {
        hosi_folio: Number(citaCtx.hosi_folio || 0),
        saved: Boolean(notaBloqueada.value),
      });
    } catch (e) {
      error.value = e instanceof Error ? e.message : "Error cargando datos del paciente";
    }
  })();

  consultaContextInflight = run;
  consultaContextInflightKey = key;
  try {
    await run;
  } finally {
    if (consultaContextInflight === run) {
      consultaContextInflight = null;
      consultaContextInflightKey = "";
    }
  }
}

function limpiarConsulta() {
  if (notaBloqueada.value) {
    error.value = "La nota ya está grabada; no se puede limpiar ni modificar.";
    return;
  }
  consultaOkLocal.value = false;
  consulta.sintomas = "";
  consulta.objetivo = "";
  consulta.analisis = "";
  consulta.plan = "";
  consulta.diai_clacie1 = "";
  consulta.diai_clacie2 = "";
  consulta.diai_clacie3 = "";
  consulta.diai_clacie4 = "";
  consulta.diai_clacie5 = "";
  consulta.motivoCie10 = "";
  consulta.motivoConsulta = "";
  consulta.diagnosticoTexto = "";
  consulta.diagnosticoTexto2 = "";
  consulta.diagnosticoTexto3 = "";
  consulta.diagnosticoTexto4 = "";
  consulta.diagnosticoTexto5 = "";
  consulta.enfermedadPrimeraVez = false;
  consulta.enfermedadSub = false;
  consulta.conn_tipocon = "";
  tipoconMotivo.value = "";
  dxSlotsVisible.value = 1;
  consultaLoadedFolio.value = 0;
  notaCronica.diabetes = "negativo";
  notaCronica.hipertension = "negativo";
  notaCronica.obesidad = "negativo";
  notaCronica.alergias = "negativo";
  notaCronica.alergiasDetalle = "";
  alergiasLista.value = [];
  alergiaNueva.value = "";
  syncingAlergiaCatalogoSel.value = true;
  alergiaCatalogoSel.value = [];
  syncingAlergiaCatalogoSel.value = false;
  alergiaOtroTexto.value = "";
  antecedentesVisitados.value = false;
  procedimientosSel.value = [];
  procQ.value = "";
}

function openExpedienteConsulta() {
  if (!citaCtx.ficha) {
    error.value = "Seleccione una cita con paciente";
    return;
  }
  emit("openExpediente", {
    ficha: citaCtx.ficha,
    codigo: citaCtx.codigo || "00",
    empresa: Number(citaCtx.empresa ?? 0),
    hosi_folio: citaCtx.hosi_folio || undefined,
    unitrab: citaCtx.unitrab_nota || props.session.unitrab,
  });
}

async function loadHistorialPaciente() {
  if (!citaCtx.ficha) {
    historialNotas.value = [];
    return;
  }
  try {
    const data = await post<{ rows: Record<string, unknown>[] }>("/sub/atmed/notas/historial", {
      ...props.session,
      ficha: citaCtx.ficha,
      codigo: citaCtx.codigo || "00",
      empresa: citaCtx.empresa || 0,
      limit: 30,
    });
    historialNotas.value = data.rows || [];
  } catch {
    historialNotas.value = [];
  }
}

async function abrirNotaHistorial(row: Record<string, unknown>) {
  const folio = Number(row.hosi_folio || 0);
  const unitrabNota = row.unitrab ?? props.session.unitrab;
  if (!folio) {
    notifyWarning("La nota del historial no tiene folio válido.");
    return;
  }
  if (row.schema_ok === false) {
    notifyWarning("Esta nota no está disponible para apertura.");
    return;
  }
  loading.value = true;
  try {
    const res = await post<{ record: Record<string, unknown>; mensaje?: string }>("/sub/atmed/notas/abrir", {
      ...props.session,
      hosi_folio: folio,
      unitrab_nota: unitrabNota,
    });
    const r = res.record || {};
    citaCtx.hosi_folio = folio;
    citaCtx.ficha = String(r.derc_ficha || citaCtx.ficha || "");
    citaCtx.codigo = String(r.derc_codigo || citaCtx.codigo || "00");
    citaCtx.empresa = Number(r.emp_clave ?? citaCtx.empresa ?? 0);
    citaCtx.paciente = String(r.paciente || citaCtx.paciente || "");
    citaCtx.especialidad = String(r.especialidad || citaCtx.especialidad || "");
    citaCtx.medico = String(r.medico || citaCtx.medico || "");
    citaCtx.esps_espserv = Number(r.esps_espserv || citaCtx.esps_espserv || 0);
    citaCtx.unitrab_nota = (r.unitrab as string | number) ?? unitrabNota;
    consulta.hosi_folio = folio;
    consultaLoadedFolio.value = 0;
    notaBloqueada.value = false;
    consultaOkLocal.value = false;
    tab.value = "consulta";
    await loadConsultaContext(true);
    if (notaBloqueada.value) {
      emit("consultaGuardada", { hosi_folio: folio, saved: true });
    }
    notifySuccess(`Nota del folio ${folio} abierta en consulta.`);
  } catch (e) {
    error.value = e instanceof Error ? e.message : "No se pudo abrir la nota";
  } finally {
    loading.value = false;
  }
}

async function grabarAdendum() {
  if (!consulta.hosi_folio || !adendumTexto.value.trim()) return;
  loading.value = true;
  try {
    const res = await post<{ record?: { plan?: string } }>("/sub/atmed/consulta/adendum", {
      ...props.session,
      hosi_folio: consulta.hosi_folio,
      texto: adendumTexto.value.trim(),
    });
    if (res.record?.plan) consulta.plan = String(res.record.plan);
    adendumOpen.value = false;
    adendumTexto.value = "";
    okMsg.value = "Adendum registrado";
  } catch (e) {
    error.value = e instanceof Error ? e.message : "Error en adendum";
  } finally {
    loading.value = false;
  }
}

function openRecetaConsulta() {
  if (!consulta.hosi_folio || !citaCtx.ficha) {
    error.value = "Seleccione una cita con paciente para emitir receta";
    return;
  }
  if (!notaBloqueada.value) {
    error.value = "Debe grabar la nota clínica antes de emitir receta.";
    return;
  }
  emit("openReceta", {
    ficha: citaCtx.ficha,
    codigo: citaCtx.codigo || "00",
    empresa: citaCtx.empresa || 0,
    hosi_folio: citaCtx.hosi_folio || undefined,
    paciente: citaCtx.paciente || "",
    diagnostico: [consulta.diai_clacie1, consulta.diagnosticoTexto].filter(Boolean).join(" ").trim(),
    unitrab: citaCtx.unitrab_nota || props.session.unitrab,
  });
}

function openPlanNutricionalConsulta() {
  if (!citaCtx.ficha && !consulta.hosi_folio) {
    error.value = "Seleccione una cita con paciente para el plan nutricional";
    return;
  }
  if (!puedePlanNutricional.value) {
    error.value =
      "El plan nutricional aplica cuando el IMC indica sobrepeso u obesidad. Capture peso y estatura en signos vitales.";
    return;
  }
  emit("openPlanNutricional", {
    clasificacion: planNutricionalClasificacion.value,
    imc: planNutricionalImc.value,
    ficha: citaCtx.ficha || undefined,
    hosi_folio: consulta.hosi_folio || citaCtx.hosi_folio || undefined,
  });
}

function openSolicitudesConsulta() {
  const folio = Number(consulta.hosi_folio || citaCtx.hosi_folio || 0);
  if (!folio) {
    error.value = "Seleccione una cita con paciente para solicitudes";
    return;
  }
  if (!notaBloqueada.value) {
    error.value = "Debe grabar la nota clínica antes de abrir Solicitudes.";
    return;
  }
  emit("openSolicitudes", {
    hosi_folio: folio,
    ficha: citaCtx.ficha || undefined,
    codigo: citaCtx.codigo || undefined,
    unitrab: citaCtx.unitrab_nota || props.session.unitrab,
  });
}

function usarCitaEnAsignar(row: Record<string, unknown>) {
  asignar.ficha = String(row.derc_ficha || "");
  asignar.codigo = String(row.derc_codigo || "00");
  if (row.emp_clave != null && row.emp_clave !== "") {
    asignar.empresa = Number(row.emp_clave);
  }
  asignar.folioConsulta = String(row.hosi_folio || "");
  loadPaciente();
}

async function verCitaExistente(row?: Record<string, unknown>) {
  const cita = row || citasPaciente.value[0];
  if (!cita) return;
  const fechaCita = String(cita.citd_fechcita || asignar.fecha || "").slice(0, 10);
  if (fechaCita) {
    fecha.value = fechaCita;
    asignar.fecha = fechaCita;
  }
  tab.value = "agenda";
  await load();
  const folio = Number(cita.hosi_folio);
  const found = rows.value.find((r) => Number(r.hosi_folio) === folio);
  if (found) selectedAgendaRow.value = found;
}

function altasCensoPendientes(): string[] {
  const out: string[] = [];
  if (notaCronica.diabetes === "positivo" && !censoBase.diabetes) out.push("diabetes");
  if (notaCronica.hipertension === "positivo" && !censoBase.hipertension) out.push("hipertensión");
  if (notaCronica.obesidad === "positivo" && !censoBase.obesidad) out.push("obesidad/sobrepeso");
  return out;
}

async function doConsulta() {
  if (!consulta.hosi_folio) {
    error.value = "Seleccione una cita (folio)";
    return;
  }
  if (notaBloqueada.value) {
    error.value = "La nota clínica ya fue grabada y no se puede modificar.";
    return;
  }
  if (consultaBloqueadaSinSignos.value) {
    error.value =
      "Esta especialidad exige signos vitales antes de grabar la nota. Abra SIGNOS VITALES primero.";
    revealConsultaErrorTab();
    return;
  }
  if (!soapCompleto.value) {
    error.value =
      `SOAP incompleto: cada campo requiere al menos ${SOAP_MIN_CHARS} caracteres ` +
      `(Plan sin contar el bloque automático de signos). Faltan: ${soapFaltantes.value.join(", ")}`;
    revealConsultaErrorTab();
    return;
  }
  if (!diagnosticoCapturado.value) {
    error.value = "Capture el diagnóstico de consulta (CIE-10 y descripción) antes de grabar la nota.";
    revealConsultaErrorTab();
    return;
  }
  if (!diagnosticoCalificado.value) {
    error.value = "Califique el diagnóstico: 1ª vez o subsecuente.";
    revealConsultaErrorTab();
    return;
  }
  syncAlergiasDetalleFromLista();
  syncCronicosEnAnalisis();
  consulta.conn_tipocon = consulta.enfermedadSub ? "S" : "P";
  const altas = altasCensoPendientes();
  if (altas.length) {
    censoConfirmPendientes.value = altas;
    censoConfirmOpen.value = true;
    return;
  }
  await grabarConsultaConfirmada();
}

async function grabarConsultaConfirmada() {
  censoConfirmOpen.value = false;
  loading.value = true;
  error.value = "";
  try {
    const res = await post<{ mensaje: string }>("/sub/atmed/consulta", {
      ...props.session,
      hosi_folio: consulta.hosi_folio,
      sintomas: consulta.sintomas,
      objetivo: consulta.objetivo,
      analisis: consulta.analisis,
      plan: consulta.plan,
      diai_clacie1: consulta.diai_clacie1,
      diai_clacie2: consulta.diai_clacie2,
      diai_clacie3: consulta.diai_clacie3,
      diai_clacie4: consulta.diai_clacie4,
      diai_clacie5: consulta.diai_clacie5,
      conn_tipocon: consulta.conn_tipocon,
      conn_tipoatn: "C",
      diabetes: notaCronica.diabetes === "positivo",
      hipertension: notaCronica.hipertension === "positivo",
      obesidad: notaCronica.obesidad === "positivo",
      alergias: notaCronica.alergias === "positivo",
      alergias_texto:
        notaCronica.alergias === "positivo"
          ? alergiasLista.value.join("\n") || notaCronica.alergiasDetalle || "ALERGIA REFERIDA"
          : "ALERGIAS NO REGISTRADAS",
    });
    okMsg.value = res.mensaje;
    consultaOkLocal.value = true;
    notaBloqueada.value = true;
    censoBase.diabetes = notaCronica.diabetes === "positivo";
    censoBase.hipertension = notaCronica.hipertension === "positivo";
    censoBase.obesidad = notaCronica.obesidad === "positivo";
    emit("consultaGuardada", {
      hosi_folio: Number(consulta.hosi_folio),
      saved: true,
    });
    await load();
    await loadRecetasConsulta();
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
  const required: [keyof typeof signos, string][] = [
    ["pulso", "Pulso"],
    ["respiracion", "Respiración"],
    ["tension_sis", "Tensión sistólica"],
    ["tension_dia", "Tensión diastólica"],
    ["temperatura", "Temperatura"],
    ["peso", "Peso"],
    ["estatura", "Estatura"],
  ];
  const faltantes = required
    .filter(([key]) => !String(signos[key] ?? "").trim())
    .map(([, label]) => label);
  if (faltantes.length) {
    error.value = `Signos incompletos: capture ${faltantes.join(", ")}`;
    return;
  }
  loading.value = true;
  error.value = "";
  try {
    const res = await post<{ mensaje: string; record?: { obesidad_censo?: boolean } }>(
      "/sub/atmed/signos",
      { ...props.session, ...signos },
    );
    okMsg.value = res.mensaje;
    await loadUltimosSignos();
    const resumen = formatSignosResumenLinea(signos);
    syncSignosEnPlan(resumen);
    const ta = clasificacionTension(signos.tension_sis, signos.tension_dia);
    if (ta === "HIPERTENSO" && notaCronica.hipertension === "negativo") {
      notaCronica.hipertension = "positivo";
    }
    const imc = calcImc(signos.peso, signos.estatura);
    if (imc != null) {
      notaCronica.obesidad = imc >= 25 ? "positivo" : "negativo";
      if (res.record?.obesidad_censo != null) {
        censoBase.obesidad = Boolean(res.record.obesidad_censo);
      }
      syncCronicosEnAnalisis();
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : "Error al grabar signos";
  } finally {
    loading.value = false;
  }
}

watch(
  () => [asignar.medicoKey, asignar.fecha],
  () => {
    if (tab.value === "asignar") loadHoras();
  },
);

watch(
  () => asignar.fecha,
  () => {
    if (tab.value === "asignar" && pacienteBuscado.value) loadCitasPaciente();
  },
);

watch(
  () => fecha.value,
  (v) => {
    calMonth.value = v.slice(0, 7);
  },
  { immediate: true },
);

watch(tab, async (t) => {
  if (t === "consulta" && !puedeClinica.value) {
    tab.value = "agenda";
    error.value = "Su rol no tiene acceso a la consulta clínica.";
    return;
  }
  if (t === "asignar") {
    if (!asignar.fecha || asignar.fecha < hoyIso.value) {
      asignar.fecha = fecha.value >= hoyIso.value ? fecha.value : hoyIso.value;
    }
    await loadEmpresasCat();
    await loadCatalogos();
    if (pacienteBuscado.value) await loadCitasPaciente();
  }
  if (t === "consulta") {
    consultaOkLocal.value = false;
    // force: al entrar al tab siempre refrescar (p. ej. otra cita de la agenda).
    await loadConsultaContext(true);
  }
});

watch(
  () => props.initialModule,
  (mod) => {
    if (!mod) return;
    if (mod === "consulta" && !puedeClinica.value) return;
    tab.value = mod;
  },
  { immediate: true },
);

watch(error, (msg) => {
  if (!msg) return;
  notifyError(msg);
  error.value = "";
});

watch(okMsg, (msg) => {
  if (!msg) return;
  notifySuccess(msg);
  okMsg.value = "";
});

watch(asignarOkFolio, (folio) => {
  if (!folio) return;
  notifySuccess(`Cita registrada. Folio de cita médica: ${folio}`, "Cita grabada");
});

onMounted(async () => {
  await load();
  await loadEmpresasCat();
  await loadCatalogos();
});
</script>

<template>
  <div class="siah-atmed-widget space-y-3">
    <div
      class="siah-clinical-shell grid grid-cols-1 min-h-[32rem]"
      :class="showAsideRail ? 'lg:grid-cols-[240px_minmax(0,1fr)]' : ''"
    >
      <aside v-if="showAsideRail" class="sidebar flex flex-col gap-4 min-w-0">
        <div v-if="showChromeNav" class="siah-clinical-card siah-side-card">
          <h3>Accesos rápidos</h3>
          <div class="siah-side-actions mt-3">
            <button
              v-for="nav in sidebarNav"
              :key="nav.id"
              type="button"
              class="siah-proto-btn"
              :class="{ 'siah-proto-btn--active': nav.kind === 'module' && sidebarTabActive === nav.id }"
              @click="onSidebarNavClick(nav)"
            >
              {{ nav.label }}
            </button>
          </div>
        </div>

        <div v-if="tab === 'asignar'" class="siah-clinical-card siah-side-card">
          <div class="siah-mini-cal">
            <div class="siah-mini-cal-head">
              <button type="button" class="siah-cal-nav" aria-label="Mes anterior" @click="shiftCalMonth(-1)">‹</button>
              <span>{{ formatCalMonthLabel(calMonth) }}</span>
              <button type="button" class="siah-cal-nav" aria-label="Mes siguiente" @click="shiftCalMonth(1)">›</button>
            </div>
            <div class="siah-mini-cal-grid siah-mini-cal-grid--head">
              <span v-for="d in DIAS_CAL" :key="d">{{ d.slice(0, 1).toUpperCase() }}</span>
            </div>
            <div v-for="(week, wi) in calWeeks" :key="wi" class="siah-mini-cal-grid">
              <button
                v-for="(day, di) in week"
                :key="`${wi}-${di}`"
                type="button"
                class="siah-cal-day"
                :class="{
                  'siah-cal-day--empty': !day,
                  'siah-cal-day--selected': isCalendarDaySelected(day),
                  'siah-cal-day--today': day === selectedCalDay && calMonth === fecha.slice(0, 7),
                  'siah-cal-day--dot': calendarDayHasCitas(day),
                }"
                :disabled="!day"
                @click="pickCalendarDay(day)"
              >
                {{ day || "" }}
              </button>
            </div>
          </div>
          <p class="side-note text-xs text-[var(--siah-muted)] mt-3 pt-3 border-t border-[var(--siah-line)] m-0">
            Después de buscar al paciente, selecciona el día de la nueva cita.
          </p>
        </div>
      </aside>

      <main class="siah-atmed-main">
        <div v-if="!showChromeNav" class="mb-2 flex flex-wrap gap-1.5">
          <UButton
            v-for="nav in sidebarNav"
            :key="`embed-${nav.id}`"
            size="xs"
            :variant="nav.kind === 'module' && sidebarTabActive === nav.id ? 'solid' : 'soft'"
            color="primary"
            @click="onSidebarNavClick(nav)"
          >
            {{ nav.label }}
          </UButton>
        </div>
        <div v-if="tab === 'agenda'" class="siah-agenda-medica siah-agenda-focus">
          <p class="siah-crumb">Atención médica / Agenda médica</p>
          <div class="siah-agenda-head">
            <div>
              <h1 class="siah-page-title">AGENDA MÉDICA</h1>
              <div class="siah-session-context">{{ agendaSessionContext }}</div>
            </div>
            <div class="siah-top-actions">
              <button type="button" class="siah-proto-btn" :disabled="loading" @click="load">
                ↻ Verificar citas
              </button>
              <button
                type="button"
                class="siah-proto-btn"
                :disabled="!rows.length"
                @click="imprimirAgenda"
              >
                Imprimir
              </button>
            </div>
          </div>

          <div class="siah-compact-metrics">
            <span>▦ Citas del día <b>{{ agendaKpis.total }}</b></span>
            <span class="siah-metric--wait">◷ En espera <b>{{ agendaKpis.espera }}</b></span>
            <span class="siah-metric--pending">◷ Por confirmar <b>{{ agendaKpis.confirmar }}</b></span>
            <span class="siah-metric--done">✓ Atendidos <b>{{ agendaKpis.atendido }}</b></span>
            <span>Espera / consulta promedio <b>{{ tiempoEsperaProm }} / {{ tiempoConsultaProm }}</b></span>
          </div>

          <div v-if="!medicoSesionLocked" class="siah-agenda-extra-filters">
            <label class="siah-field">
              Especialidad
              <USelect
                v-model="agendaFiltroEsp"
                :items="agendaFiltroEspItems"
                placeholder="Especialidad"
                size="md"
                class="w-full mt-[7px]"
              />
            </label>
            <label class="siah-field">
              Médico
              <USelect
                v-model="agendaFiltroMed"
                :items="[
                  { label: 'Todos los médicos', value: null },
                  ...medicos
                    .filter((m) => String(m.medc_ficha || '').trim())
                    .map((m) => ({
                      label: m.medc_nombre || m.medc_ficha,
                      value: m.medc_ficha,
                    })),
                ]"
                placeholder="Médico"
                size="md"
                class="w-full mt-[7px]"
              />
            </label>
          </div>

          <section class="siah-workspace">
            <div class="siah-toolbar">
              <div>
                <h2 class="siah-toolbar-title">{{ agendaDayTitle }}</h2>
                <p class="siah-toolbar-sub">Citas del médico de la sesión.</p>
              </div>
              <div class="siah-date-tools">
                <button type="button" class="siah-proto-btn" aria-label="Día anterior" @click="moveAgendaDay(-1)">‹</button>
                <AtmedDatePicker
                  :model-value="fecha"
                  :clearable="false"
                  class="siah-agenda-datepicker"
                  @update:model-value="onAgendaFechaChange"
                />
                <button type="button" class="siah-proto-btn" aria-label="Día siguiente" @click="moveAgendaDay(1)">›</button>
                <button type="button" class="siah-proto-btn" @click="goAgendaToday">Hoy</button>
              </div>
            </div>

            <div class="siah-list-controls">
              <div class="siah-tabs-focus" role="tablist" aria-label="Filtrar citas por estado">
                <button
                  type="button"
                  role="tab"
                  :aria-selected="agendaFocusTab === 'todo'"
                  @click="setAgendaFocusTab('todo')"
                >
                  Por atender
                  <span class="siah-tab-count">{{ agendaKpis.todo }}</span>
                </button>
                <button
                  type="button"
                  role="tab"
                  :aria-selected="agendaFocusTab === 'wait'"
                  @click="setAgendaFocusTab('wait')"
                >
                  En espera
                </button>
                <button
                  type="button"
                  role="tab"
                  :aria-selected="agendaFocusTab === 'done'"
                  @click="setAgendaFocusTab('done')"
                >
                  Atendidos
                </button>
                <button
                  type="button"
                  role="tab"
                  :aria-selected="agendaFocusTab === 'all'"
                  @click="setAgendaFocusTab('all')"
                >
                  Todas
                </button>
              </div>
              <input
                v-model="agendaBusqueda"
                class="siah-search-focus"
                placeholder="Buscar paciente, ficha o folio…"
                aria-label="Buscar cita"
                @input="agendaPage = 1"
              />
            </div>

            <div class="siah-table-wrap">
              <table class="siah-focus-table">
                <thead>
                  <tr>
                    <th>No.</th>
                    <th>FOLIO</th>
                    <th>CITA</th>
                    <th>LLEGÓ</th>
                    <th>INICIO</th>
                    <th>FICHA</th>
                    <th>PACIENTE</th>
                    <th>MOTIVO DE CONSULTA</th>
                    <th>DIAGNÓSTICO DE CONSULTA</th>
                    <th>ESTATUS</th>
                    <th>ACCIONES</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-if="loading && !rowsFiltradas.length">
                    <td colspan="11" class="siah-empty-focus">Cargando…</td>
                  </tr>
                  <tr v-else-if="!rowsFiltradas.length">
                    <td colspan="11" class="siah-empty-focus">
                      No hay citas en esta vista para la fecha seleccionada.<br />
                      <span class="siah-muted">Puedes cambiar de estado o consultar otra fecha.</span>
                    </td>
                  </tr>
                  <tr
                    v-for="(row, idx) in agendaPageRows"
                    v-else
                    :key="String(row.hosi_folio)"
                    class="siah-focus-row"
                    :class="agendaRowClasses(row)"
                    @click="openAgendaDrawer(row)"
                  >
                    <td class="siah-col-num">{{ agendaPageFrom + idx }}</td>
                    <td>{{ row.hosi_folio }}</td>
                    <td class="siah-col-time"><b>{{ formatHoraCelda(row.citn_hrcita) }}</b></td>
                    <td class="siah-col-time">{{ formatHoraCelda(row.cits_hrllegada) || "—" }}</td>
                    <td class="siah-col-time">—</td>
                    <td>{{ row.derc_ficha }}</td>
                    <td>
                      <span class="siah-patient-link">{{ row.paciente }}</span>
                      <div v-if="procedenciaBadgeLabel(row)" class="siah-patient-origin">
                        <span :class="procedenciaBadgeClass(row)">{{ procedenciaBadgeLabel(row) }}</span>
                      </div>
                    </td>
                    <td>{{ row.especialidad || "—" }}</td>
                    <td>—</td>
                    <td>
                      <span :class="citaStatusBadgeClass(row.cits_estatus)">
                        {{ citaStatusLabel(row.cits_estatus) }}
                      </span>
                    </td>
                    <td @click.stop>
                      <div class="siah-row-actions">
                        <button
                          v-if="agendaPrimaryAction(row).kind === 'attend' && puedeClinica"
                          type="button"
                          class="siah-proto-btn siah-proto-btn--primary"
                          @click="openConsultaFromAgenda(row)"
                        >
                          {{ agendaPrimaryAction(row).label }}
                        </button>
                        <button
                          v-else-if="agendaPrimaryAction(row).kind === 'note' && puedeClinica"
                          type="button"
                          class="siah-proto-btn"
                          @click="openConsultaFromAgenda(row)"
                        >
                          {{ agendaPrimaryAction(row).label }}
                        </button>
                        <button
                          v-else-if="agendaPrimaryAction(row).kind === 'arrival'"
                          type="button"
                          class="siah-proto-btn siah-proto-btn--primary"
                          :disabled="String(row.citd_fechcita || fecha).slice(0, 10) > hoyIso"
                          @click="selectAgendaRow(row); llegada(Number(row.hosi_folio))"
                        >
                          {{ agendaPrimaryAction(row).label }}
                        </button>
                        <button
                          type="button"
                          class="siah-proto-btn"
                          title="Ver expediente"
                          @click="openExpedienteFromAgenda(row)"
                        >
                          Exp.
                        </button>
                      </div>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div class="siah-table-foot">
              <span class="siah-muted">
                Mostrando {{ agendaPageFrom }} a {{ agendaPageTo }} de {{ rowsFiltradas.length }} citas
              </span>
              <UPagination
                v-model:page="agendaPage"
                :items-per-page="TABLE_PAGE_SIZE"
                :total="rowsFiltradas.length"
                :sibling-count="1"
                show-edges
                size="sm"
              />
            </div>
          </section>

          <div class="siah-legend-focus">
            <span>Estados:</span>
            <span class="siah-badge siah-badge--pending">POR CONFIRMAR</span>
            <span class="siah-badge siah-badge--wait">EN ESPERA</span>
            <span class="siah-badge siah-badge--done">ATENDIDO</span>
            <span class="siah-badge siah-badge--deferred">DIFERIDO</span>
            <span class="siah-badge siah-badge--absent">NO ATENDIDO</span>
            <span class="siah-badge siah-badge--local">LOCAL</span>
            <span class="siah-badge siah-badge--foreign">FORÁNEO</span>
          </div>

          <div
            v-if="agendaDrawerOpen && selectedAgendaRow"
            class="siah-drawer-backdrop"
            @click.self="closeAgendaDrawer"
          >
            <aside class="siah-drawer-panel" role="dialog" aria-modal="true" aria-labelledby="agendaDrawerTitle">
              <div class="siah-drawer-header">
                <h2 id="agendaDrawerTitle">Detalle del paciente</h2>
                <button type="button" class="siah-proto-btn" aria-label="Cerrar" @click="closeAgendaDrawer">×</button>
              </div>
              <div class="siah-drawer-content">
                <span :class="citaStatusBadgeClass(selectedAgendaRow.cits_estatus)">
                  {{ citaStatusLabel(selectedAgendaRow.cits_estatus) }}
                </span>
                <div class="siah-drawer-patient">{{ selectedAgendaRow.paciente || "—" }}</div>
                <p class="siah-muted">Unidad médica {{ session.unitrab }}</p>
                <div class="siah-drawer-data">
                  <div>
                    <small>Folio</small>
                    <b>{{ selectedAgendaRow.hosi_folio }}</b>
                  </div>
                  <div>
                    <small>Ficha</small>
                    <b>{{ selectedAgendaRow.derc_ficha }}</b>
                  </div>
                  <div>
                    <small>Cita</small>
                    <b>{{ formatHoraCelda(selectedAgendaRow.citn_hrcita) || "—" }}</b>
                  </div>
                  <div>
                    <small>Llegada</small>
                    <b>{{ formatHoraCelda(selectedAgendaRow.cits_hrllegada) || "—" }}</b>
                  </div>
                  <div>
                    <small>Procedencia</small>
                    <b>{{ procedenciaBadgeLabel(selectedAgendaRow) || "—" }}</b>
                  </div>
                  <div>
                    <small>Especialidad</small>
                    <b>{{ selectedAgendaRow.especialidad || "—" }}</b>
                  </div>
                  <div class="siah-wide">
                    <small>Médico</small>
                    <b>{{ selectedAgendaRow.medico || selectedAgendaRow.medc_nombre || "—" }}</b>
                  </div>
                </div>
                <div class="siah-drawer-buttons">
                  <button
                    v-if="puedeClinica && (puedeIniciarAtencion(selectedAgendaRow) || citaAtendida(selectedAgendaRow))"
                    type="button"
                    class="siah-proto-btn"
                    :class="citaAtendida(selectedAgendaRow) ? '' : 'siah-proto-btn--primary'"
                    :disabled="!citaAtendida(selectedAgendaRow) && iniciarAtencionDisabled"
                    @click="openConsultaFromAgenda(selectedAgendaRow)"
                  >
                    {{ citaAtendida(selectedAgendaRow) ? "Ver nota médica" : "Iniciar atención médica" }}
                  </button>
                  <button type="button" class="siah-proto-btn" @click="openExpedienteFromAgenda(selectedAgendaRow)">
                    Ver expediente
                  </button>
                  <button
                    type="button"
                    class="siah-proto-btn"
                    :disabled="loading || llegadaDisabled"
                    @click="llegadaSelected"
                  >
                    Registrar llegada
                  </button>
                  <button
                    type="button"
                    class="siah-proto-btn"
                    :disabled="loading || !selectedAgendaRow || citaAtendida(selectedAgendaRow)"
                    @click="diferirCitaSelected"
                  >
                    Diferir cita
                  </button>
                  <button
                    type="button"
                    class="siah-proto-btn"
                    :disabled="loading"
                    @click="confirmarCitaSelected"
                  >
                    Confirmar cita
                  </button>
                  <button
                    type="button"
                    class="siah-proto-btn"
                    :disabled="loading || revertirLlegadaDisabled"
                    @click="revertirLlegadaSelected"
                  >
                    Revertir llegada
                  </button>
                </div>
              </div>
            </aside>
          </div>
        </div>

        <div v-else-if="tab === 'asignar'" class="siah-asigna siah-asigna--flujo">
          <p class="siah-crumb">Atención médica / Registro de cita médica</p>
          <div class="mb-1">
            <h1 class="siah-page-title">Registro de cita médica</h1>
            <p class="siah-page-sub">
              Busca al paciente, captura su cita y revisa los datos antes de confirmar.
            </p>
          </div>

          <div class="siah-steps">
            <div class="siah-step" :class="{ 'siah-step--active': true }">
              <b>1</b> Buscar paciente
            </div>
            <div class="siah-step" :class="{ 'siah-step--active': pacienteBuscado }">
              <b>2</b> Datos del paciente
            </div>
            <div class="siah-step" :class="{ 'siah-step--active': pacienteBuscado }">
              <b>3</b> Nueva cita
            </div>
            <div class="siah-step" :class="{ 'siah-step--active': pacienteBuscado && !!paciente.nombre }">
              <b>4</b> Revisar y confirmar
            </div>
          </div>

          <AtmedSectionCard number="1" title="Buscar paciente">
            <template #actions>
              <button
                type="button"
                class="siah-proto-btn"
                style="padding: 6px 11px; font-size: 12px"
                :disabled="loading || asignando || paciente.loading"
                @click="limpiarAsignar"
              >
                Limpiar
              </button>
            </template>
            <p v-if="buscarHint" class="siah-hint-info mb-3 text-[12px] text-[var(--siah-muted)]">{{ buscarHint }}</p>
            <div class="siah-search-grid">
              <label class="siah-field">
                Número de ficha
                <input
                  v-model="asignar.ficha"
                  class="siah-native"
                  inputmode="numeric"
                  placeholder="Captura la ficha"
                  @blur="loadBeneficiariosPorFicha"
                  @keydown.enter.prevent="loadPaciente"
                />
              </label>
              <label class="siah-field" title="Codificación del beneficiario">
                Código de paciente
                <select
                  v-model="asignar.codigo"
                  class="siah-native"
                  @keydown.enter.prevent="loadPaciente"
                >
                  <option v-for="c in codigosOptions" :key="c.value" :value="c.value">
                    {{ c.label }}
                  </option>
                </select>
              </label>
              <label class="siah-field" title="Empresa / contrato">
                Código de empresa
                <select
                  v-model.number="asignar.empresa"
                  class="siah-native"
                  @keydown.enter.prevent="loadPaciente"
                >
                  <option
                    v-for="e in empresasOptions"
                    :key="e.emp_clave"
                    :value="e.emp_clave"
                  >
                    {{ e.emp_clave }} — {{ e.emp_descrip }}
                  </option>
                </select>
              </label>
              <button
                type="button"
                class="siah-proto-btn siah-proto-btn--primary"
                :disabled="paciente.loading"
                @click="loadPaciente"
              >
                ⌕ Buscar paciente
              </button>
            </div>
          </AtmedSectionCard>

          <template v-if="pacienteBuscado">
            <AtmedSectionCard number="2" title="Datos del paciente">
              <template #actions>
                <span
                  class="siah-badge"
                  :class="pacienteVigente ? 'siah-badge--wait' : pacienteVigenciaLabel === 'SIN DATO' ? 'siah-badge--all' : 'siah-badge--pending'"
                >
                  {{ pacienteVigenciaLabel }}
                </span>
              </template>
              <div class="siah-paciente-card">
                <div class="siah-foto-wrap">
                  <img
                    v-if="patientPhotoUrl && !photoFailed"
                    :src="patientPhotoUrl"
                    alt="Foto del paciente"
                    class="siah-foto"
                    @error="photoFailed = true"
                  />
                  <div v-else class="siah-foto siah-foto--placeholder">
                    <span v-if="paciente.loading">…</span>
                    <span v-else>SIN FOTO</span>
                  </div>
                </div>
                <div class="siah-paciente-card__body">
                  <div class="siah-paciente-card__head">
                    <p class="siah-paciente-card__nombre">{{ paciente.nombre || "—" }}</p>
                  </div>
                  <div class="siah-paciente-card__meta">
                    <span><strong>Edad</strong> {{ paciente.edad || "—" }}</span>
                    <span><strong>Ficha</strong> {{ asignar.ficha }}-{{ asignar.codigo }}</span>
                    <span><strong>Departamento</strong> {{ paciente.depto || "—" }}</span>
                    <span><strong>UMA</strong> {{ [paciente.uma, paciente.umaDescri].filter(Boolean).join(" · ") || "—" }}</span>
                  </div>
                </div>
              </div>
              <UAlert
                v-if="pacienteVigenciaLabel === 'NO VIGENTE'"
                color="warning"
                variant="subtle"
                class="mt-2"
                title="El paciente no está vigente. Puede continuar con advertencia; la regla de bloqueo está pendiente."
              />
            </AtmedSectionCard>

            <UAlert
              v-if="citasPaciente.length"
              color="error"
              variant="subtle"
              title="Cita existente"
              class="mt-1"
            >
              <template #description>
                <p class="text-sm m-0 mb-2">{{ citaDuplicadaMsg }}</p>
                <UButton
                  label="Ver cita"
                  color="error"
                  variant="soft"
                  size="xs"
                  @click="verCitaExistente(citasPaciente[0])"
                />
              </template>
            </UAlert>

            <AtmedSectionCard number="3" title="Datos de la nueva cita">
              <div class="siah-appointment-grid">
                <label class="siah-field siah-wide">
                  Médico
                  <select
                    v-model="asignar.medicoKey"
                    class="siah-native"
                    :disabled="medicoSesionLocked && medicosAsignables.length <= 1"
                    :title="
                      medicoSesionLocked
                        ? 'Médico de sesión: no puede agendar con otro médico'
                        : undefined
                    "
                    @change="onMedicoChange"
                  >
                    <option
                      v-for="m in medicosAsignables"
                      :key="medicoOptionKey(m)"
                      :value="medicoOptionKey(m)"
                    >
                      {{ medicoOptionLabel(m) }}
                    </option>
                  </select>
                </label>
                <label class="siah-field">
                  Especialidad
                  <input
                    class="siah-native"
                    type="text"
                    readonly
                    :value="especialidadNombre || 'Se asigna según el médico'"
                  />
                </label>
                <label class="siah-field">
                  Fecha
                  <AtmedDatePicker
                    v-model="asignar.fecha"
                    class="mt-[7px]"
                    :min="hoyIso"
                    :clearable="false"
                  />
                </label>
                <label class="siah-field">
                  Hora
                  <select v-model.number="asignar.hora" class="siah-native">
                    <option v-if="!horas.length" :value="0" disabled>Sin horarios disponibles</option>
                    <option v-for="h in horas" :key="h.hora" :value="h.hora">{{ h.label }}</option>
                  </select>
                </label>
                <label class="siah-field siah-wide">
                  Observaciones <span class="text-[var(--siah-muted)] font-normal">(opcional)</span>
                  <textarea
                    v-model="asignar.observaciones"
                    class="siah-native"
                    rows="3"
                    maxlength="500"
                    placeholder="Agrega información relevante para la cita…"
                  />
                  <div class="siah-fields-counter">{{ asignar.observaciones.length }} / 500</div>
                </label>
              </div>
              <UAlert
                v-if="citaDuplicadaDia"
                color="error"
                variant="subtle"
                class="mt-2"
                :title="`No se puede confirmar: el paciente ya tiene cita el mismo día (${citaDuplicadaMsg}).`"
              />
            </AtmedSectionCard>

            <AtmedSectionCard number="4" title="Revisar y confirmar">
              <template #actions>
                <span class="siah-badge" :class="puedeConfirmarCita ? 'siah-badge--wait' : 'siah-badge--all'">
                  {{ puedeConfirmarCita ? "LISTA PARA REGISTRAR" : "PENDIENTE" }}
                </span>
              </template>
              <div class="siah-summary-grid">
                <div>
                  <small>Paciente</small>
                  <strong>
                    {{ paciente.nombre || "—" }}<span v-if="paciente.edad"> · {{ paciente.edad }} años</span>
                  </strong>
                </div>
                <div>
                  <small>Especialidad</small>
                  <strong>{{ especialidadNombre || "—" }}</strong>
                </div>
                <div>
                  <small>Médico</small>
                  <strong>{{ medicoNombre || "—" }}</strong>
                </div>
                <div>
                  <small>Fecha</small>
                  <strong>{{ formatFechaDisplay(asignar.fecha) || "—" }}</strong>
                </div>
                <div>
                  <small>Hora</small>
                  <strong>{{ horaLabel || "—" }}</strong>
                </div>
                <div>
                  <small>Folio</small>
                  <strong>{{ asignarOkFolio || "Se genera al confirmar" }}</strong>
                </div>
              </div>
              <div class="siah-form-actions">
                <button type="button" class="siah-proto-btn" :disabled="asignando" @click="limpiarAsignar">
                  Cancelar
                </button>
                <button
                  type="button"
                  class="siah-proto-btn siah-proto-btn--primary"
                  :disabled="!puedeConfirmarCita || asignando"
                  @click="doAsignar"
                >
                  ✓ Grabar cita
                </button>
              </div>
            </AtmedSectionCard>
          </template>
        </div>

        <div v-else-if="tab === 'consulta'" class="siah-note-main siah-note-tabs-layout min-w-0">
          <p class="siah-crumb">Atención médica / Consulta / Nota médica</p>
          <div class="siah-agenda-head">
            <div>
              <h1 class="siah-page-title">REGISTRO DE NOTA MÉDICA</h1>
              <p class="siah-page-sub">{{ consultaStatusLine }}</p>
            </div>
            <span
              class="siah-badge"
              :class="notaBloqueada ? 'siah-badge--done' : consulta.hosi_folio ? 'siah-badge--wait' : 'siah-badge--all'"
            >
              {{ notaBloqueada ? "NOTA GRABADA" : consulta.hosi_folio ? "EN CAPTURA" : "SIN CITA" }}
            </span>
          </div>

          <div v-if="!consulta.hosi_folio" class="siah-notice">
            Seleccione una cita en la agenda (Iniciar atención) para iniciar la consulta.
          </div>

          <template v-else>
            <section class="siah-patient-strip siah-clinical-card">
              <div class="siah-patient-ident">
                <span class="siah-initials">{{ pacienteInitials }}</span>
                <div>
                  <strong>{{ citaCtx.paciente || "—" }}</strong>
                  <div class="siah-muted">
                    Ficha <b>{{ citaCtx.ficha || "—" }}</b>
                    · Código {{ citaCtx.codigo || "—" }}
                    · Empresa {{ citaCtx.empresa ?? "—" }}
                    · {{ citaCtx.edad ? `${citaCtx.edad} años` : "—" }}
                    · {{ citaCtx.sexo || "—" }}
                  </div>
                </div>
              </div>
              <div class="siah-patient-tools">
                <span
                  v-if="normalizeProcedencia(citaCtx.procedencia)"
                  :class="normalizeProcedencia(citaCtx.procedencia)?.className"
                >
                  {{ normalizeProcedencia(citaCtx.procedencia)?.label }}
                </span>
                <span
                  class="siah-badge"
                  :class="!consultaRequiereSignos || consultaTieneSignos ? 'siah-badge--wait' : 'siah-badge--all'"
                >
                  {{
                    !consultaRequiereSignos
                      ? "SIGNOS N/A"
                      : consultaTieneSignos
                        ? "SIGNOS GRABADOS"
                        : "SIGNOS PENDIENTES"
                  }}
                </span>
                <button type="button" class="siah-proto-btn" @click="patientDialogOpen = true">
                  Ver paciente
                </button>
              </div>
            </section>

            <div
              v-if="patientDialogOpen"
              class="siah-drawer-backdrop"
              @click.self="patientDialogOpen = false"
            >
              <aside class="siah-drawer-panel" role="dialog" aria-modal="true" aria-labelledby="notaPatientDrawerTitle">
                <div class="siah-drawer-header">
                  <h2 id="notaPatientDrawerTitle">Detalle del paciente</h2>
                  <button
                    type="button"
                    class="siah-proto-btn"
                    aria-label="Cerrar"
                    @click="patientDialogOpen = false"
                  >
                    ×
                  </button>
                </div>
                <div class="siah-drawer-content">
                  <span
                    class="siah-badge"
                    :class="notaBloqueada ? 'siah-badge--done' : 'siah-badge--wait'"
                  >
                    {{ notaBloqueada ? "NOTA GRABADA" : "EN CAPTURA" }}
                  </span>
                  <div class="siah-drawer-patient">{{ citaCtx.paciente || "—" }}</div>
                  <p class="siah-muted">Unidad médica {{ session.unitrab }}</p>
                  <div class="siah-drawer-data">
                    <div>
                      <small>Folio</small>
                      <b>{{ citaCtx.hosi_folio || "—" }}</b>
                    </div>
                    <div>
                      <small>Ficha</small>
                      <b>{{ citaCtx.ficha || "—" }}</b>
                    </div>
                    <div>
                      <small>Cita</small>
                      <b>{{ formatHoraCelda(citaCtx.horaCita) || "—" }}</b>
                    </div>
                    <div>
                      <small>Inicio</small>
                      <b>{{ formatHoraCelda(citaCtx.horaInicio) || "—" }}</b>
                    </div>
                    <div>
                      <small>Término</small>
                      <b>{{ formatHoraCelda(citaCtx.horaTermino) || "Sin finalizar" }}</b>
                    </div>
                    <div>
                      <small>Código</small>
                      <b>{{ citaCtx.codigo || "—" }}</b>
                    </div>
                    <div>
                      <small>Empresa</small>
                      <b>{{ citaCtx.empresa ?? "—" }}</b>
                    </div>
                    <div>
                      <small>Procedencia</small>
                      <b>{{ citaCtx.procedencia || "—" }}</b>
                    </div>
                    <div>
                      <small>Fecha de nacimiento</small>
                      <b>{{ citaCtx.fecnac || "—" }}</b>
                    </div>
                    <div>
                      <small>Edad</small>
                      <b>{{ citaCtx.edad || "—" }}</b>
                    </div>
                    <div>
                      <small>Sexo</small>
                      <b>{{ citaCtx.sexo || "—" }}</b>
                    </div>
                    <div>
                      <small>Sangre</small>
                      <b>{{ citaCtx.sangre || "No registrada" }}</b>
                    </div>
                    <div class="siah-wide">
                      <small>Especialidad</small>
                      <b>{{ citaCtx.especialidad || "—" }}</b>
                    </div>
                    <div class="siah-wide">
                      <small>Médico</small>
                      <b>{{ citaCtx.medico || session.username || "—" }}</b>
                    </div>
                  </div>
                  <div class="siah-drawer-buttons">
                    <button
                      type="button"
                      class="siah-proto-btn"
                      :disabled="!citaCtx.ficha"
                      @click="openExpedienteConsulta"
                    >
                      Ver expediente
                    </button>
                    <button type="button" class="siah-proto-btn" @click="patientDialogOpen = false">
                      Cerrar
                    </button>
                  </div>
                </div>
              </aside>
            </div>

            <div class="siah-tab-workspace">
              <div class="siah-note-tabs-bar">
                <div class="siah-note-tabs" role="tablist" aria-label="Apartados de la nota médica">
                  <button
                    type="button"
                    role="tab"
                    :aria-selected="consultaUiTab === 'vitals'"
                    @click="switchConsultaTab('vitals')"
                  >
                    Signos y antecedentes
                  </button>
                  <button
                    type="button"
                    role="tab"
                    :aria-selected="consultaUiTab === 'clinical'"
                    @click="switchConsultaTab('clinical')"
                  >
                    Nota clínica
                  </button>
                  <button
                    type="button"
                    role="tab"
                    :aria-selected="consultaUiTab === 'diagnostic'"
                    @click="switchConsultaTab('diagnostic')"
                  >
                    Diagnósticos y procedimientos
                  </button>
                  <button
                    type="button"
                    role="tab"
                    :aria-selected="consultaUiTab === 'history'"
                    @click="switchConsultaTab('history')"
                  >
                    Historial
                  </button>
                </div>
                <div class="siah-note-tab-actions">
                  <button
                    type="button"
                    class="siah-proto-btn"
                    :disabled="!citaCtx.ficha"
                    @click="openExpedienteConsulta"
                  >
                    Expediente
                  </button>
                  <button
                    type="button"
                    class="siah-proto-btn"
                    :disabled="!consulta.hosi_folio || !notaBloqueada"
                    title="Disponible solo después de grabar la nota"
                    @click="openRecetaConsulta"
                  >
                    Receta
                  </button>
                  <button
                    type="button"
                    class="siah-proto-btn"
                    :disabled="!consulta.hosi_folio || !notaBloqueada"
                    title="Disponible solo después de grabar la nota"
                    @click="openSolicitudesConsulta"
                  >
                    Solicitudes
                  </button>
                  <button
                    type="button"
                    class="siah-proto-btn"
                    :disabled="!puedePlanNutricional"
                    :title="
                      puedePlanNutricional
                        ? `Plan nutricional (${planNutricionalClasificacion})`
                        : 'Requiere IMC de sobrepeso u obesidad (peso y estatura)'
                    "
                    @click="openPlanNutricionalConsulta"
                  >
                    Plan nutricional
                  </button>
                  <button
                    type="button"
                    class="siah-proto-btn"
                    :disabled="!notaBloqueada"
                    title="Disponible solo después de grabar la nota"
                    @click="adendumOpen = true"
                  >
                    Adéndum
                  </button>
                </div>
              </div>

              <div v-show="consultaUiTab === 'vitals'" class="siah-tab-panel" role="tabpanel">
            <AtmedSectionCard title="Signos vitales">
              <div class="siah-vital-columns">
                <div class="siah-vital-column">
                  <div class="siah-vital-head">
                    <strong>Últimos signos registrados</strong>
                    <span class="muted text-xs text-[var(--siah-muted)]">
                      {{ ultimosFechaLabel || "Sin toma previa disponible" }}
                    </span>
                  </div>
                  <div class="siah-vital-content">
                    <div class="siah-vital-group">
                      <div class="siah-group-title">Cardiovascular</div>
                      <div class="siah-vital-grid">
                        <div class="siah-last-item"><small>Pulso</small><b>{{ ultimosSignos?.pulso || "—" }}</b><span>lpm</span></div>
                        <div class="siah-last-item"><small>TA sistólica</small><b>{{ ultimosSignos?.tension_sis || "—" }}</b><span>mmHg</span></div>
                        <div class="siah-last-item"><small>TA diastólica</small><b>{{ ultimosSignos?.tension_dia || "—" }}</b><span>mmHg</span></div>
                      </div>
                    </div>
                    <div class="siah-vital-group">
                      <div class="siah-group-title">Respiratorio</div>
                      <div class="siah-vital-grid">
                        <div class="siah-last-item"><small>Frecuencia respiratoria</small><b>{{ ultimosSignos?.respiracion || "—" }}</b><span>rpm</span></div>
                        <div class="siah-last-item"><small>Saturación de O₂</small><b>{{ ultimosSignos?.saturacion || "—" }}</b><span>%</span></div>
                      </div>
                    </div>
                    <div class="siah-vital-group">
                      <div class="siah-group-title">Temperatura</div>
                      <div class="siah-vital-grid">
                        <div class="siah-last-item"><small>Temperatura</small><b>{{ ultimosSignos?.temperatura || "—" }}</b><span>°C</span></div>
                      </div>
                    </div>
                    <div class="siah-vital-group">
                      <div class="siah-group-title">Antropometría</div>
                      <div class="siah-vital-grid">
                        <div class="siah-last-item"><small>Peso</small><b>{{ ultimosSignos?.peso || "—" }}</b><span>kg</span></div>
                        <div class="siah-last-item"><small>Estatura</small><b>{{ ultimosSignos?.estatura || "—" }}</b><span>m</span></div>
                        <div class="siah-last-item"><small>Perímetro abdominal</small><b>{{ ultimosSignos?.abdominal || "—" }}</b><span>cm</span></div>
                      </div>
                    </div>
                  </div>
                </div>

                <div class="siah-vital-column">
                  <div class="siah-vital-head">
                    <strong>Registro actual</strong>
                    <span class="muted text-xs text-[var(--siah-muted)]">Signos de esta consulta · * Campos obligatorios</span>
                  </div>
                  <div class="siah-vital-content">
                    <div class="siah-vital-group">
                      <div class="siah-group-title">Cardiovascular</div>
                      <div class="siah-vital-grid">
                        <label class="siah-field">Pulso *<div class="siah-input-unit"><input v-model="signos.pulso" inputmode="numeric" :disabled="notaBloqueada" aria-label="Pulso"><span>lpm</span></div></label>
                        <label class="siah-field">TA sistólica *<div class="siah-input-unit"><input v-model="signos.tension_sis" inputmode="numeric" :disabled="notaBloqueada" aria-label="TA sistólica"><span>mmHg</span></div></label>
                        <label class="siah-field">TA diastólica *<div class="siah-input-unit"><input v-model="signos.tension_dia" inputmode="numeric" :disabled="notaBloqueada" aria-label="TA diastólica"><span>mmHg</span></div></label>
                      </div>
                    </div>
                    <div class="siah-vital-group">
                      <div class="siah-group-title">Respiratorio</div>
                      <div class="siah-vital-grid">
                        <label class="siah-field">Frecuencia respiratoria *<div class="siah-input-unit"><input v-model="signos.respiracion" inputmode="numeric" :disabled="notaBloqueada" aria-label="Frecuencia respiratoria"><span>rpm</span></div></label>
                        <label class="siah-field">Saturación de O₂<div class="siah-input-unit"><input v-model="signos.saturacion" inputmode="numeric" placeholder="50–100" :disabled="notaBloqueada" aria-label="Saturación de O₂"><span>%</span></div></label>
                      </div>
                    </div>
                    <div class="siah-vital-group">
                      <div class="siah-group-title">Temperatura</div>
                      <div class="siah-vital-grid">
                        <label class="siah-field">Temperatura *<div class="siah-input-unit"><input v-model="signos.temperatura" inputmode="decimal" :disabled="notaBloqueada" aria-label="Temperatura"><span>°C</span></div></label>
                      </div>
                    </div>
                    <div class="siah-vital-group">
                      <div class="siah-group-title">Antropometría</div>
                      <div class="siah-vital-grid">
                        <label class="siah-field">Peso *<div class="siah-input-unit"><input v-model="signos.peso" inputmode="decimal" :disabled="notaBloqueada" aria-label="Peso"><span>kg</span></div></label>
                        <label class="siah-field">Estatura *<div class="siah-input-unit"><input v-model="signos.estatura" inputmode="decimal" :disabled="notaBloqueada" aria-label="Estatura"><span>m</span></div></label>
                        <label class="siah-field">Perímetro abdominal<div class="siah-input-unit"><input v-model="signos.abdominal" inputmode="numeric" :disabled="notaBloqueada" aria-label="Perímetro abdominal"><span>cm</span></div></label>
                      </div>
                    </div>
                    <p v-if="signosImc != null" class="siah-helper">
                      IMC: <b>{{ signosImc }}</b>
                      <span v-if="signosClasificacion"> · {{ signosClasificacion }}</span>
                      <span v-if="signosTensionClasificacion"> · TA {{ signosTensionClasificacion }}</span>
                    </p>
                    <div class="siah-vital-toolbar">
                      <button
                        type="button"
                        class="siah-proto-btn"
                        :disabled="!ultimosSignos"
                        :title="ultimosFechaLabel || 'Última toma del paciente'"
                        @click="copiarUltimosSignos"
                      >
                        Copiar antecedente
                      </button>
                      <button
                        type="button"
                        class="siah-proto-btn siah-proto-btn--primary"
                        :disabled="loading"
                        @click="doSignos"
                      >
                        Grabar signos vitales
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </AtmedSectionCard>

            <AtmedSectionCard title="Síndrome metabólico">
              <p class="siah-helper">
                Antecedentes de la consulta. Pulsa una etiqueta para cambiar el registro.
                <span v-if="notaBloqueada"> Nota grabada: solo lectura.</span>
              </p>
              <div class="siah-metabolic">
                <div class="siah-condition">
                  <label>Diabetes</label>
                  <button
                    type="button"
                    class="siah-badge"
                    :class="notaCronica.diabetes === 'positivo' ? 'siah-badge--pending' : 'siah-badge--wait'"
                    :disabled="notaBloqueada"
                    @click="toggleCronico('diabetes')"
                  >
                    {{ notaCronica.diabetes === "positivo" ? "REGISTRADA" : "NO REGISTRADA" }}
                  </button>
                </div>
                <div class="siah-condition">
                  <label>Hipertensión</label>
                  <button
                    type="button"
                    class="siah-badge"
                    :class="notaCronica.hipertension === 'positivo' ? 'siah-badge--pending' : 'siah-badge--wait'"
                    :disabled="notaBloqueada"
                    @click="toggleCronico('hipertension')"
                  >
                    {{ notaCronica.hipertension === "positivo" ? "REGISTRADA" : "NO REGISTRADA" }}
                  </button>
                </div>
                <div class="siah-condition">
                  <label>Obesidad</label>
                  <button
                    type="button"
                    class="siah-badge"
                    :class="notaCronica.obesidad === 'positivo' ? 'siah-badge--pending' : 'siah-badge--wait'"
                    :disabled="notaBloqueada"
                    @click="toggleCronico('obesidad')"
                  >
                    {{ notaCronica.obesidad === "positivo" ? "REGISTRADA" : "NO REGISTRADA" }}
                  </button>
                </div>
                <div class="siah-condition">
                  <label>Alergias</label>
                  <button
                    type="button"
                    class="siah-badge"
                    :class="notaCronica.alergias === 'positivo' ? 'siah-badge--pending' : 'siah-badge--wait'"
                    :disabled="notaBloqueada"
                    @click="toggleCronico('alergias')"
                  >
                    {{ notaCronica.alergias === "positivo" ? "REGISTRADAS" : "NO REGISTRADAS" }}
                  </button>
                </div>
              </div>
              <div v-if="notaCronica.alergias === 'positivo'" class="mt-3 space-y-2">
                <p class="text-[0.7rem] font-semibold text-muted m-0">
                  Detalle de alergias (puede seleccionar varias)
                </p>
                <p v-if="alergiasCatalogoError" class="m-0 text-[0.7rem] text-amber-700">
                  {{ alergiasCatalogoError }}
                </p>
                <div class="flex flex-wrap items-end gap-2">
                  <UFormField label="Alérgenos" class="min-w-[16rem] flex-1" :ui="notaFieldUi">
                    <USelectMenu
                      v-model="alergiaCatalogoSel"
                      multiple
                      :items="alergiaSelectItems"
                      value-key="value"
                      label-key="label"
                      size="sm"
                      class="w-full"
                      :loading="loadingAlergiasCatalogo"
                      :disabled="notaBloqueada"
                      placeholder="Seleccione una o más alergias…"
                      :search-input="{ placeholder: 'Escriba para filtrar…' }"
                      @update:open="onAlergiaSelectOpen"
                    />
                  </UFormField>
                  <UFormField
                    v-if="alergiaOtroSeleccionado"
                    label="Especifique"
                    class="min-w-[12rem] flex-1"
                    :ui="notaFieldUi"
                  >
                    <UInput
                      v-model="alergiaOtroTexto"
                      size="sm"
                      class="w-full min-w-0"
                      :disabled="notaBloqueada"
                      placeholder="Describa el alérgeno"
                      @keyup.enter="agregarAlergiaDesdeCatalogo"
                    />
                  </UFormField>
                  <UButton
                    v-if="alergiaOtroSeleccionado"
                    label="Agregar"
                    color="primary"
                    size="sm"
                    :disabled="notaBloqueada || !alergiaOtroTexto.trim()"
                    @click="agregarAlergiaDesdeCatalogo"
                  />
                </div>
                <ul v-if="alergiasLista.length" class="m-0 list-none space-y-1 p-0">
                  <li
                    v-for="(a, idx) in alergiasLista"
                    :key="`${a}-${idx}`"
                    class="flex items-center justify-between gap-2 rounded-md border border-default px-2 py-1 text-xs"
                  >
                    <span>{{ a }}</span>
                    <UButton
                      icon="i-lucide-x"
                      size="xs"
                      color="neutral"
                      variant="ghost"
                      :disabled="notaBloqueada"
                      @click="quitarAlergia(idx)"
                    />
                  </li>
                </ul>
                <p v-else class="text-[0.7rem] text-muted m-0">
                  Seleccione una o más del catálogo, o use «Otro» para capturar texto libre.
                </p>
              </div>
            </AtmedSectionCard>
              </div>

              <div v-show="consultaUiTab === 'clinical'" class="siah-tab-panel" role="tabpanel">
            <AtmedSectionCard title="Motivo de consulta">
              <p class="siah-helper">
                Autocomplete CIE-10 (≥2 caracteres). No se carga el catálogo completo al cliente.
              </p>
              <div class="siah-clinical-grid">
                <CatalogAutocomplete
                  :api-base="apiBase"
                  :api-prefix="apiPrefix"
                  :session="session"
                  tipo="cie10"
                  label="Buscar CIE-10 (motivo de consulta)"
                  placeholder="Clave o descripción (mín. 2 caracteres)"
                  :disabled="notaBloqueada"
                  @select="onPickCieMotivo"
                />
                <UFormField label="CIE-10" class="w-full" :ui="notaFieldUi">
                  <UInput
                    v-model="consulta.motivoCie10"
                    maxlength="5"
                    size="md"
                    class="w-full uppercase"
                    :disabled="notaBloqueada"
                  />
                </UFormField>
                <UFormField label="Motivo de consulta" class="w-full min-w-0" :ui="notaFieldUi">
                  <UInput
                    v-model="consulta.motivoConsulta"
                    size="md"
                    class="w-full min-w-0"
                    :disabled="notaBloqueada"
                  />
                </UFormField>
              </div>
            </AtmedSectionCard>

            <AtmedSectionCard title="Nota clínica">
              <p class="siah-helper">
                Completa los cuatro apartados. Mínimo {{ SOAP_MIN_CHARS }} caracteres por apartado.
                <span v-if="notaBloqueada"> Solo lectura.</span>
              </p>
              <p v-if="soapBloqueadoSinSignos" class="siah-helper" style="color: #aa6600">
                Capture signos vitales antes de editar Síntomas y Objetivo.
              </p>
              <div class="siah-nota-fields siah-soap">
                <label class="siah-field">
                  Síntomas o subjetivo *
                  <UTextarea
                    v-model="consulta.sintomas"
                    :rows="5"
                    autoresize
                    class="w-full mt-[7px]"
                    :ui="notaTextareaUi"
                    :disabled="notaBloqueada || soapBloqueadoSinSignos"
                    placeholder="Captura síntomas o subjetivo…"
                  />
                  <div class="siah-fields-counter">
                    {{ soapLens.sintomas }} caracteres · mínimo {{ SOAP_MIN_CHARS }}
                  </div>
                </label>
                <label class="siah-field">
                  Objetivo *
                  <UTextarea
                    v-model="consulta.objetivo"
                    :rows="5"
                    autoresize
                    class="w-full mt-[7px]"
                    :ui="notaTextareaUi"
                    :disabled="notaBloqueada || soapBloqueadoSinSignos"
                    placeholder="Captura objetivo…"
                  />
                  <div class="siah-fields-counter">
                    {{ soapLens.objetivo }} caracteres · mínimo {{ SOAP_MIN_CHARS }}
                  </div>
                </label>
                <label class="siah-field">
                  Análisis *
                  <UTextarea
                    v-model="consulta.analisis"
                    :rows="5"
                    autoresize
                    class="w-full mt-[7px]"
                    :ui="notaTextareaUi"
                    :disabled="notaBloqueada"
                    placeholder="Captura análisis…"
                  />
                  <div class="siah-fields-counter">
                    {{ soapLens.analisis }} caracteres · mínimo {{ SOAP_MIN_CHARS }}
                  </div>
                </label>
                <label class="siah-field">
                  Plan *
                  <UTextarea
                    v-model="consulta.plan"
                    :rows="5"
                    autoresize
                    class="w-full mt-[7px]"
                    :ui="notaTextareaUi"
                    :disabled="notaBloqueada"
                    placeholder="Captura plan…"
                  />
                  <div class="siah-fields-counter">
                    {{ soapLens.plan }} caracteres · mínimo {{ SOAP_MIN_CHARS }}
                  </div>
                </label>
              </div>
            </AtmedSectionCard>
              </div>

              <div v-show="consultaUiTab === 'diagnostic'" class="siah-tab-panel" role="tabpanel">
            <AtmedSectionCard title="Diagnóstico de consulta">
              <div class="space-y-3">
                <CatalogAutocomplete
                  :api-base="apiBase"
                  :api-prefix="apiPrefix"
                  :session="session"
                  tipo="cie10"
                  label="Buscar CIE-10 (diagnóstico)"
                  placeholder="Clave o descripción (≥2 caracteres)…"
                  :disabled="notaBloqueada"
                  @select="onPickCieDx($event, dxSlotsVisible)"
                />
                <div class="flex flex-wrap items-end gap-3">
                  <UFormField label="CIE-10" class="w-24">
                    <UInput
                      v-model="consulta.diai_clacie1"
                      maxlength="5"
                      placeholder="Ej. R51X"
                      size="sm"
                      class="uppercase"
                      :disabled="notaBloqueada"
                    />
                  </UFormField>
                  <UFormField label="Diagnóstico de consulta" class="min-w-0 flex-1 w-full" :ui="notaFieldUi">
                    <UInput
                      v-model="consulta.diagnosticoTexto"
                      size="sm"
                      class="w-full min-w-0"
                      :disabled="notaBloqueada"
                    />
                  </UFormField>
                  <div class="siah-radio-line">
                    <b>Enfermedad</b>
                    <button
                      type="button"
                      class="siah-proto-btn"
                      :class="{ 'siah-proto-btn--active': consulta.enfermedadPrimeraVez }"
                      :disabled="notaBloqueada || !diagnosticoCapturado"
                      @click="setTipoConsulta(true)"
                    >
                      Primera vez
                    </button>
                    <button
                      type="button"
                      class="siah-proto-btn"
                      :class="{ 'siah-proto-btn--active': consulta.enfermedadSub }"
                      :disabled="notaBloqueada || !diagnosticoCapturado"
                      @click="setTipoConsulta(false)"
                    >
                      Subsecuente
                    </button>
                    <span v-if="tipoconMotivo" class="text-[0.65rem] text-[var(--siah-muted)] max-w-xs">
                      {{ tipoconMotivo }}
                    </span>
                  </div>
                  <button
                    type="button"
                    class="siah-proto-btn"
                    title="Agregar diagnóstico (máx. 5)"
                    :disabled="notaBloqueada || dxSlotsVisible >= 5"
                    @click="agregarDiagnostico"
                  >
                    ＋ Agregar diagnóstico
                  </button>
                </div>
                <div v-if="dxSlotsVisible >= 2" class="flex flex-wrap items-end gap-3">
                  <UFormField label="CIE-10 (2)" class="w-24">
                    <UInput
                      v-model="consulta.diai_clacie2"
                      maxlength="5"
                      size="sm"
                      class="uppercase"
                      :disabled="notaBloqueada"
                    />
                  </UFormField>
                  <UFormField label="Diagnóstico 2" class="min-w-0 flex-1 w-full" :ui="notaFieldUi">
                    <UInput
                      v-model="consulta.diagnosticoTexto2"
                      size="sm"
                      class="w-full min-w-0"
                      :disabled="notaBloqueada"
                    />
                  </UFormField>
                </div>
                <div v-if="dxSlotsVisible >= 3" class="flex flex-wrap items-end gap-3">
                  <UFormField label="CIE-10 (3)" class="w-24">
                    <UInput
                      v-model="consulta.diai_clacie3"
                      maxlength="5"
                      size="sm"
                      class="uppercase"
                      :disabled="notaBloqueada"
                    />
                  </UFormField>
                  <UFormField label="Diagnóstico 3" class="min-w-0 flex-1 w-full" :ui="notaFieldUi">
                    <UInput
                      v-model="consulta.diagnosticoTexto3"
                      size="sm"
                      class="w-full min-w-0"
                      :disabled="notaBloqueada"
                    />
                  </UFormField>
                </div>
                <div v-if="dxSlotsVisible >= 4" class="flex flex-wrap items-end gap-3">
                  <UFormField label="CIE-10 (4)" class="w-24">
                    <UInput
                      v-model="consulta.diai_clacie4"
                      maxlength="5"
                      size="sm"
                      class="uppercase"
                      :disabled="notaBloqueada"
                    />
                  </UFormField>
                  <UFormField label="Diagnóstico 4" class="min-w-0 flex-1 w-full" :ui="notaFieldUi">
                    <UInput
                      v-model="consulta.diagnosticoTexto4"
                      size="sm"
                      class="w-full min-w-0"
                      :disabled="notaBloqueada"
                    />
                  </UFormField>
                </div>
                <div v-if="dxSlotsVisible >= 5" class="flex flex-wrap items-end gap-3">
                  <UFormField label="CIE-10 (5)" class="w-24">
                    <UInput
                      v-model="consulta.diai_clacie5"
                      maxlength="5"
                      size="sm"
                      class="uppercase"
                      :disabled="notaBloqueada"
                    />
                  </UFormField>
                  <UFormField label="Diagnóstico 5" class="min-w-0 flex-1 w-full" :ui="notaFieldUi">
                    <UInput
                      v-model="consulta.diagnosticoTexto5"
                      size="sm"
                      class="w-full min-w-0"
                      :disabled="notaBloqueada"
                    />
                  </UFormField>
                </div>
              </div>
            </AtmedSectionCard>

            <AtmedSectionCard title="Procedimientos médicos">
              <p class="text-[0.7rem] text-muted m-0 mb-2">
                Catálogo CIE-9 / procedimientos de consultorio (autocomplete ≥2 caracteres). Se anexa al Plan.
              </p>
              <CatalogAutocomplete
                v-model="procQ"
                :api-base="apiBase"
                :api-prefix="apiPrefix"
                :session="session"
                tipo="procedimientos"
                placeholder="Buscar procedimiento…"
                :disabled="notaBloqueada"
                @select="onPickProcedimiento"
              />
              <ul v-if="procedimientosSel.length" class="mt-2 m-0 list-none space-y-1 p-0">
                <li
                  v-for="p in procedimientosSel"
                  :key="p.clave"
                  class="flex items-center justify-between gap-2 rounded-md border border-default px-2 py-1 text-xs"
                >
                  <span
                    ><strong>{{ p.clave }}</strong> — {{ p.descripcion }}</span
                  >
                  <UButton
                    icon="i-lucide-x"
                    size="xs"
                    color="neutral"
                    variant="ghost"
                    :disabled="notaBloqueada"
                    @click="quitarProcedimiento(p.clave)"
                  />
                </li>
              </ul>
            </AtmedSectionCard>
              </div>

              <div v-show="consultaUiTab === 'history'" class="siah-tab-panel" role="tabpanel">
            <AtmedSectionCard title="Historial de notas">
              <input
                v-model="historialBusqueda"
                class="siah-search-focus"
                style="max-width: 380px; margin: 0 0 15px"
                placeholder="Buscar por folio, fecha o unidad…"
                aria-label="Buscar notas"
              />
              <div class="siah-consulta-ficha !border-0">
                <table>
                  <thead>
                    <tr>
                      <th>No.</th>
                      <th>FOLIO</th>
                      <th>FECHA</th>
                      <th>UNIDAD MÉDICA</th>
                      <th>HOSPITAL</th>
                      <th>ESTATUS</th>
                      <th>ACCIONES</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-if="!historialFiltrado.length">
                      <td colspan="7" class="siah-empty-focus">Sin notas en el historial.</td>
                    </tr>
                    <tr v-for="(h, idx) in historialPageRows" :key="`${h.hosi_folio}-${h.unitrab}`">
                      <td>{{ historialPageFrom + idx }}</td>
                      <td><b>{{ h.hosi_folio }}</b></td>
                      <td>{{ h.cond_fechcon || "—" }}</td>
                      <td>{{ h.unitrab }}</td>
                      <td>{{ h.hospital || "—" }}</td>
                      <td>
                        <span
                          :class="h.schema_ok ? 'siah-badge siah-badge--done' : 'siah-badge siah-badge--pending'"
                        >
                          {{ h.schema_ok ? "NOTA GRABADA" : "NO DISPONIBLE" }}
                        </span>
                      </td>
                      <td>
                        <button
                          type="button"
                          class="siah-proto-btn"
                          style="padding: 6px 9px; font-size: 11px"
                          :disabled="!h.schema_ok"
                          @click="abrirNotaHistorial(h)"
                        >
                          Abrir nota
                        </button>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <div class="siah-table-footer !border-t-0 !px-0 !bg-transparent">
                <p class="m-0">
                  Mostrando {{ historialPageFrom }} a {{ historialPageTo }} de
                  {{ historialFiltrado.length }} registros · {{ TABLE_PAGE_SIZE }} por página
                </p>
                <UPagination
                  v-model:page="historialPage"
                  :items-per-page="TABLE_PAGE_SIZE"
                  :total="historialFiltrado.length"
                  :sibling-count="1"
                  show-edges
                  size="sm"
                />
              </div>
            </AtmedSectionCard>
              </div>

              <div class="siah-save-bar siah-save-bar--sticky">
                <div>
                  <b>{{ consultaStepHint }}</b>
                  <p class="muted m-0 mt-1 text-xs text-[var(--siah-muted)]">
                    Los datos se conservan al cambiar de pestaña.
                  </p>
                </div>
                <div class="siah-save-actions">
                  <button
                    v-if="consultaUiTab !== 'vitals'"
                    type="button"
                    class="siah-proto-btn"
                    @click="moveConsultaTab(-1)"
                  >
                    Anterior
                  </button>
                  <button
                    v-if="consultaUiTab === 'vitals' || consultaUiTab === 'clinical'"
                    type="button"
                    class="siah-proto-btn siah-proto-btn--primary"
                    @click="moveConsultaTab(1)"
                  >
                    {{
                      consultaUiTab === "vitals"
                        ? "Continuar a nota clínica →"
                        : "Continuar a diagnósticos →"
                    }}
                  </button>
                  <button
                    type="button"
                    class="siah-proto-btn"
                    :disabled="notaBloqueada"
                    @click="limpiarConsulta"
                  >
                    Limpiar
                  </button>
                  <button
                    type="button"
                    class="siah-proto-btn siah-proto-btn--primary"
                    :disabled="!puedeGrabarNota || loading"
                    :title="
                      notaBloqueada
                        ? 'La nota ya fue grabada'
                        : !diagnosticoCapturado
                          ? 'Capture el diagnóstico de consulta'
                          : !diagnosticoCalificado
                            ? 'Califique el diagnóstico: 1ª vez o subsecuente'
                            : undefined
                    "
                    @click="doConsulta"
                  >
                    {{ notaBloqueada ? "✓ Nota grabada" : "✓ Grabar consulta" }}
                  </button>
                </div>
              </div>
            </div>

          </template>
        </div>
      </main>
    </div>

    <UModal v-model:open="censoConfirmOpen" :ui="{ content: 'max-w-md w-full' }">
      <template #content>
        <div class="space-y-3 p-4">
          <h3 class="text-sm font-bold uppercase text-highlighted m-0">Confirmar alta a censo</h3>
          <p class="text-sm text-muted m-0">
            El paciente no estaba registrado en:
            <strong>{{ censoConfirmPendientes.join(", ") }}</strong>. ¿Alta al censo al grabar?
          </p>
          <div class="flex justify-end gap-2">
            <UButton label="Cancelar" color="neutral" variant="outline" size="sm" @click="censoConfirmOpen = false" />
            <UButton label="Confirmar y grabar" color="primary" size="sm" :loading="loading" @click="grabarConsultaConfirmada" />
          </div>
        </div>
      </template>
    </UModal>

    <UModal v-model:open="adendumOpen" :ui="{ content: 'max-w-lg w-full' }">
      <template #content>
        <div class="space-y-3 p-4">
          <h3 class="text-sm font-bold uppercase text-highlighted m-0">Adendum a la nota</h3>
          <p class="text-xs text-muted m-0">Se anexa al Plan con fecha/usuario. No modifica el SOAP original.</p>
          <UTextarea v-model="adendumTexto" :rows="5" autoresize class="w-full" placeholder="Texto del adendum…" />
          <div class="flex justify-end gap-2">
            <UButton label="Cancelar" color="neutral" variant="outline" size="sm" @click="adendumOpen = false" />
            <UButton
              label="Grabar adendum"
              color="primary"
              size="sm"
              :loading="loading"
              :disabled="adendumTexto.trim().length < 5"
              @click="grabarAdendum"
            />
          </div>
        </div>
      </template>
    </UModal>

    <SignosVitalesModal
      v-model:open="signosModalOpen"
      :loading="loading"
      :signos="signos"
      :paciente-line="`${citaCtx.paciente || 'Paciente'} · Folio ${citaCtx.hosi_folio} · Ficha ${citaCtx.ficha}-${citaCtx.codigo}`"
      :ultimos-signos="ultimosSignos"
      :signos-imc="signosImc"
      :signos-clasificacion="signosClasificacion"
      :signos-tension-clasificacion="signosTensionClasificacion"
      :ultimos-imc="ultimosImc"
      :ultimos-clasificacion="ultimosClasificacion"
      :ultimos-tension-clasificacion="ultimosTensionClasificacion"
      :ultimos-fecha-label="ultimosFechaLabel"
      @graba="doSignos"
      @copiar="copiarUltimosSignos"
      @close="closeSignosModal"
    />

    <ServiciosModal
      v-model:open="serviciosModalOpen"
      :api-base="apiBase"
      :api-prefix="apiPrefix"
      :session="session"
      :folio="consulta.hosi_folio"
      :paciente-line="`${citaCtx.paciente || 'Paciente'} · Folio ${citaCtx.hosi_folio} · Ficha ${citaCtx.ficha}-${citaCtx.codigo}`"
      :diagnostico="[consulta.diai_clacie1, consulta.diagnosticoTexto].filter(Boolean).join(' ').trim()"
      read-only
      @close="serviciosModalOpen = false"
    />

    <!-- Feedback tipo SweetAlert: solo Aceptar para cerrar -->
    <UModal
      v-model:open="alertOpen"
      :title="alertState.title"
      :description="alertState.description"
      :dismissible="true"
      :ui="{ content: 'max-w-md w-full' }"
    >
      <template #header>
        <div class="flex items-center gap-3">
          <span
            class="flex size-9 shrink-0 items-center justify-center rounded-full"
            :class="{
              'bg-success/10 text-success': alertState.color === 'success',
              'bg-error/10 text-error': alertState.color === 'error',
              'bg-warning/10 text-warning': alertState.color === 'warning',
              'bg-info/10 text-info': alertState.color === 'info',
              'bg-primary/10 text-primary': alertState.color === 'primary',
            }"
          >
            <UIcon :name="alertState.icon" class="size-5" />
          </span>
          <div>
            <h2 class="m-0 text-base font-semibold text-highlighted">{{ alertState.title }}</h2>
            <p v-if="alertState.description" class="m-0 text-sm text-muted">{{ alertState.description }}</p>
          </div>
        </div>
      </template>
      <template #footer>
        <div class="flex w-full justify-end">
          <UButton
            label="Aceptar"
            :color="alertState.color"
            block
            @click="alertOpen = false"
          />
        </div>
      </template>
    </UModal>
  </div>
</template>

<style scoped>
.siah-atmed-main {
  min-width: 0;
}

.siah-agenda-medica {
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
  min-height: 0;
}

.siah-agenda-head {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.5rem;
}

.siah-agenda-title {
  margin: 0;
  color: #1a4f8f;
  font-size: 0.82rem;
  font-weight: 800;
  letter-spacing: 0.01em;
}

.siah-agenda-subtitle {
  margin: 0.15rem 0 0;
  color: #1a4f8f;
  font-size: 0.58rem;
  font-weight: 600;
}

.siah-btn-verifica {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  border: 1px solid #888;
  background: linear-gradient(180deg, #f5f5f5 0%, #dcdcdc 100%);
  color: #222;
  font-size: 0.62rem;
  font-weight: 700;
  padding: 0.35rem 0.6rem;
  cursor: pointer;
}

.siah-btn-verifica:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.siah-btn-verifica-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.1rem;
  height: 1.1rem;
  border-radius: 999px;
  background: #2ecc71;
  color: #fff;
  font-size: 0.72rem;
  font-weight: 900;
}

.siah-agenda-table-wrap--full {
  max-height: none;
}

.siah-agenda-table--medica {
  font-size: 0.62rem;
}

.siah-agenda-table--medica th:nth-child(8),
.siah-agenda-table--medica th:nth-child(9),
.siah-agenda-table--medica td:nth-child(8),
.siah-agenda-table--medica td:nth-child(9) {
  min-width: 7rem;
}

.siah-agenda-paciente {
  font-weight: 600;
  white-space: normal;
  min-width: 200px;
}

.siah-agenda-paciente .name {
  font-weight: 700;
  display: block;
  font-size: 12px;
  margin-bottom: 5px;
  line-height: 1.4;
}

.siah-agenda-row--espera .siah-agenda-paciente {
  color: var(--siah-ink, #172344);
}

.siah-agenda-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem 0.75rem;
}

.siah-link-btn {
  border: none;
  background: transparent;
  color: #1a4f8f;
  font-size: 0.62rem;
  font-weight: 700;
  text-decoration: underline;
  cursor: pointer;
  padding: 0;
}

.siah-link-btn:disabled {
  color: #999;
  cursor: not-allowed;
  text-decoration: none;
}

.siah-agenda-count {
  margin-left: auto;
  font-size: 0.58rem;
  color: #666;
}

.siah-agenda-leyenda--full {
  gap: 0.25rem;
}

.siah-leyenda-item--local {
  background: #d7f4ff;
  color: #0a5570;
}

.siah-leyenda-item--foraneo {
  background: #ffe2c6;
  color: #8a4500;
}

.siah-leyenda-item--tramite {
  background: #f5d7ff;
  color: #6b148a;
}

.siah-leyenda-item--no-atendido {
  background: #ececec;
  color: #555;
}

.siah-leyenda-item--ver-todo {
  background: #fff3bf;
  color: #665500;
}

.siah-asigna--flujo {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
  max-width: none;
  width: 100%;
}

.siah-asigna-layout {
  display: grid;
  grid-template-columns: minmax(0, 1.15fr) minmax(280px, 0.85fr);
  gap: 0.75rem;
  align-items: start;
}

@media (max-width: 960px) {
  .siah-asigna-layout {
    grid-template-columns: 1fr;
  }
}

.siah-asigna-form,
.siah-asigna-agenda {
  border: 1px solid #b8b8b8;
  background: #fff;
  padding: 0.5rem;
}

.siah-asigna-actions {
  display: flex;
  gap: 0.35rem;
  margin-bottom: 0.5rem;
}

.siah-asigna-resumen {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(9rem, 1fr));
  gap: 0.65rem 0.85rem;
}

.siah-asigna-resumen__val {
  margin: 0.15rem 0 0;
  font-size: 0.8rem;
  font-weight: 600;
  color: #1f2937;
  word-break: break-word;
}

.siah-paciente-card {
  display: flex;
  gap: 1rem;
  align-items: flex-start;
  padding: 0.35rem 0;
}

.siah-paciente-card__body {
  flex: 1 1 auto;
  min-width: 0;
}

.siah-paciente-card__head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem 0.75rem;
  margin-bottom: 0.45rem;
}

.siah-paciente-card__nombre {
  margin: 0;
  font-size: 1rem;
  font-weight: 700;
  color: var(--siah-ink, #172344);
  line-height: 1.25;
}

.siah-paciente-card__meta {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(8.5rem, 1fr));
  gap: 0.35rem 0.75rem;
  font-size: 0.75rem;
  color: #374151;
}

.siah-paciente-card__meta strong {
  display: block;
  font-size: 0.62rem;
  font-weight: 700;
  color: #6b7280;
  text-transform: uppercase;
  letter-spacing: 0.02em;
}

.siah-btn {
  border: 1px solid #888;
  background: linear-gradient(180deg, #f5f5f5 0%, #dcdcdc 100%);
  color: #222;
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.02em;
  padding: 0.35rem 0.75rem;
  cursor: pointer;
}

.siah-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.siah-btn--graba {
  display: inline-flex;
  align-items: center;
}

.siah-field-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.25rem 0.35rem;
  margin-bottom: 0.35rem;
}

.siah-field-row--esp,
.siah-field-row--medico,
.siah-field-row--folio,
.siah-field-row--obs {
  margin-bottom: 0.45rem;
}

.siah-field-row--obs {
  align-items: flex-start;
}

.siah-field-row--vigencia {
  flex-wrap: wrap;
}

.siah-label {
  font-size: 0.62rem;
  font-weight: 700;
  color: #333;
  white-space: nowrap;
}

.siah-label--sm {
  min-width: 2.5rem;
}

.siah-label--xs {
  min-width: 1.8rem;
}

.siah-label--wrap {
  max-width: 5rem;
  white-space: normal;
  line-height: 1.1;
}

.siah-label--top {
  padding-top: 0.35rem;
}

.siah-input,
.siah-textarea {
  border: 1px solid #9aa0a6;
  background: #fff;
  color: #111;
  font-size: 0.72rem;
  padding: 0.2rem 0.35rem;
  min-height: 1.45rem;
}

.siah-input--readonly {
  background: #f3f3f3;
}

.siah-input--clave {
  width: 4rem;
}

.siah-input--grow {
  flex: 1 1 8rem;
  min-width: 6rem;
}

.siah-input--fecha {
  width: 8.5rem;
}

.siah-input--hora {
  min-width: 6.5rem;
}

.siah-input--ficha {
  width: 4.5rem;
}

.siah-input--cod,
.siah-input--emp {
  width: 2.2rem;
}

.siah-input--procedencia {
  width: 5.5rem;
}

.siah-input--vigencia {
  width: 5.5rem;
}

.siah-input--estatus {
  width: 5rem;
}

.siah-input--folio {
  width: 4.5rem;
}

.siah-textarea {
  flex: 1 1 100%;
  min-height: 4.5rem;
  resize: vertical;
}

.siah-hint {
  color: #c00;
  font-size: 0.65rem;
  font-weight: 700;
}

.siah-hint-info {
  margin: 0;
  color: #6b7280;
  font-size: 0.75rem;
  font-weight: 500;
  line-height: 1.35;
}

.siah-paciente-block {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 92px;
  gap: 0.5rem;
  margin: 0.35rem 0 0.5rem;
  padding: 0.35rem 0;
  border-top: 1px solid #ddd;
  border-bottom: 1px solid #ddd;
}

.siah-meta-grid {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  gap: 0.25rem;
  margin: 0.35rem 0;
}

@media (max-width: 720px) {
  .siah-meta-grid {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }
}

.siah-meta-item {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
}

.siah-meta-label {
  font-size: 0.58rem;
  font-weight: 700;
  color: #444;
}

.siah-input--meta {
  width: 100%;
}

.siah-foto-wrap {
  align-self: start;
}

.siah-foto {
  width: 92px;
  height: 110px;
  object-fit: cover;
  border: 1px solid #888;
  background: #ececec;
}

.siah-foto--placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.55rem;
  font-weight: 700;
  color: #666;
  text-align: center;
  padding: 0.25rem;
}

.siah-agenda-fecha {
  font-size: 0.68rem;
  font-weight: 700;
  color: #333;
  margin: 0 0 0.35rem;
  text-transform: uppercase;
}

.siah-agenda-table-wrap {
  overflow: auto;
  max-height: 28rem;
  border: 1px solid var(--siah-line, #dfe6ef);
}

.siah-agenda-acciones-col {
  position: sticky;
  right: 0;
  z-index: 2;
  background: inherit;
  box-shadow: -4px 0 6px -4px rgba(0, 0, 0, 0.12);
  white-space: nowrap;
}

thead .siah-agenda-acciones-col {
  background: #f3f5f8;
  color: var(--siah-ink, #172344);
  z-index: 3;
}

.siah-agenda-acciones {
  display: flex;
  flex-wrap: nowrap;
  gap: 0.25rem;
}

.siah-agenda-acciones__btn {
  font-size: 0.65rem;
  font-weight: 700;
  padding: 0.3rem 0.45rem;
  border: 1px solid var(--siah-line, #dfe6ef);
  border-radius: 0.35rem;
  background: #fff;
  cursor: pointer;
  color: var(--siah-ink, #172344);
}

.siah-agenda-acciones__btn:hover:not(:disabled) {
  background: #edf5f1;
  border-color: #b1d3c2;
}

.siah-agenda-acciones__btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.siah-agenda-row--confirmar .siah-agenda-acciones-col,
.siah-agenda-row--espera .siah-agenda-acciones-col,
.siah-agenda-row--atendido .siah-agenda-acciones-col,
.siah-agenda-row--diferido .siah-agenda-acciones-col,
.siah-agenda-table td.siah-agenda-acciones-col {
  background: inherit;
}

.siah-agenda-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.72rem;
  min-width: 1100px;
}

.siah-agenda-table th {
  background: #f3f5f8;
  color: var(--siah-ink, #172344);
  font-weight: 700;
  font-size: 0.65rem;
  text-align: left;
  padding: 0.75rem 0.65rem;
  border-block: 1px solid var(--siah-line, #dfe6ef);
  white-space: nowrap;
}

.siah-agenda-table td {
  padding: 0.8rem 0.65rem;
  border-bottom: 1px solid var(--siah-line, #dfe6ef);
  vertical-align: middle;
  color: var(--siah-ink, #172344);
}

.siah-agenda-row {
  cursor: pointer;
}

.siah-agenda-row:hover td {
  background: #f8fbfa;
}

.siah-agenda-empty {
  text-align: center;
  color: var(--siah-muted, #718099);
  padding: 1.25rem !important;
}

.siah-agenda-leyenda {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.4rem;
  margin-top: 0.25rem;
}
</style>
