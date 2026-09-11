<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from "vue";
import AtmedSectionCard from "./components/AtmedSectionCard.vue";
import CatalogAutocomplete from "./components/CatalogAutocomplete.vue";
import SignosVitalesModal from "./components/SignosVitalesModal.vue";
import ServiciosModal from "./components/ServiciosModal.vue";
import "./style.css";

/** UTextarea root es inline-flex por defecto; forzar ancho completo en notas. */
const notaTextareaUi = { root: "relative flex w-full items-start" };
const notaFieldUi = { root: "w-full", container: "w-full mt-1" };

const props = withDefaults(
  defineProps<{
    /** Base URL del FastAPI Subrogados (ej. http://127.0.0.1:8002) */
    apiBase: string;
    /** Prefijo opcional de rutas (proxy Laravel) */
    apiPrefix?: string;
    session: { usuario: string; password: string; unitrab: string; rol?: string };
    /**
     * Menú AGENDA/ASIGNA/CONSULTA del widget.
     * En portal Subrogados (embebido) poner false: el host controla el chrome.
     */
    showModuleNav?: boolean;
    /** Atajo: equivale a showModuleNav=false */
    embedded?: boolean;
  }>(),
  { apiPrefix: "", showModuleNav: true, embedded: false },
);

const emit = defineEmits<{
  openExpediente: [
    payload: { ficha: string; codigo: string; empresa?: number; hosi_folio?: number },
  ];
  openReceta: [
    payload: {
      ficha: string;
      codigo: string;
      empresa: number;
      hosi_folio?: number;
      paciente?: string;
      diagnostico?: string;
    },
  ];
}>();

const showChromeNav = computed(() => props.showModuleNav && !props.embedded);
/** Rol Subrogados: R = recepcionista (sin clínica). */
const sessionRol = computed(() => String(props.session?.rol || "").trim().toUpperCase());
const esRecepcionista = computed(() => sessionRol.value === "R");
const puedeClinica = computed(() => !["R", "F"].includes(sessionRol.value));
const loading = ref(false);
const error = ref("");
const okMsg = ref("");
const rows = ref<Record<string, unknown>[]>([]);
const fecha = ref(new Date().toISOString().slice(0, 10));
const tab = ref<"agenda" | "asignar" | "consulta">("agenda");
/** Rail izquierdo: menú de módulos y/o acciones+mini-cal de agenda. */
const showAsideRail = computed(() => showChromeNav.value || tab.value === "agenda");
const sidebarTabActive = computed(() => tab.value);

const especialidades = ref<{ esps_espserv: number; espc_descrip: string; requiere_signos: string }[]>([]);
const medicos = ref<{ medc_ficha: string; medc_codigo: string; medc_nombre: string; esps_espserv: number }[]>([]);
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
  { id: "agenda", label: "AGENDA MEDICA" },
  { id: "asignar", label: "ASIGNA CITA" },
  { id: "consulta", label: "CONSULTA" },
] as const;

const sidebarNav = computed(() =>
  esRecepcionista.value ? sidebarNavAll.filter((n) => n.id !== "consulta") : [...sidebarNavAll],
);

const consulta = reactive({
  hosi_folio: 0,
  sintomas: "",
  objetivo: "",
  analisis: "",
  plan: "",
  diai_clacie1: "",
  diai_clacie2: "",
  diai_clacie3: "",
  motivoCie10: "",
  motivoConsulta: "",
  diagnosticoTexto: "",
  diagnosticoTexto2: "",
  diagnosticoTexto3: "",
  enfermedadPrimeraVez: true,
  enfermedadSub: false,
  conn_tipocon: "P",
});

const notaBloqueada = ref(false);
const consultaOkLocal = ref(false);
const dxSlotsVisible = ref(1);
const antecedentesVisitados = ref(false);
const alergiasLista = ref<string[]>([]);
const alergiaNueva = ref("");
const alergiaCatalogoSel = ref("");
const alergiaOtroTexto = ref("");
const alergiasCatalogo = ref<{ clave: string; descripcion: string }[]>([]);
const signosPanelOpen = ref(true);

const notaCronica = reactive({
  diabetes: "negativo" as "negativo" | "positivo",
  hipertension: "negativo" as "negativo" | "positivo",
  obesidad: "negativo" as "negativo" | "positivo",
  alergias: "negativo" as "negativo" | "positivo",
  alergiasDetalle: "",
});

const procedimientosSel = ref<{ clave: string; descripcion: string }[]>([]);
const procQ = ref("");

function onPickCieMotivo(hit: { clave: string; descripcion: string }) {
  if (notaBloqueada.value) return;
  consulta.motivoCie10 = hit.clave.slice(0, 5).toUpperCase();
  if (!consulta.motivoConsulta.trim()) consulta.motivoConsulta = hit.descripcion;
}

function onPickCieDx(hit: { clave: string; descripcion: string }, slot = 1) {
  if (notaBloqueada.value) return;
  const clave = hit.clave.slice(0, 5).toUpperCase();
  if (slot === 1) {
    consulta.diai_clacie1 = clave;
    consulta.diagnosticoTexto = hit.descripcion;
  } else if (slot === 2) {
    consulta.diai_clacie2 = clave;
    consulta.diagnosticoTexto2 = hit.descripcion;
  } else {
    consulta.diai_clacie3 = clave;
    consulta.diagnosticoTexto3 = hit.descripcion;
  }
}

function setTipoConsulta(primeraVez: boolean) {
  if (notaBloqueada.value) return;
  consulta.enfermedadPrimeraVez = primeraVez;
  consulta.enfermedadSub = !primeraVez;
  consulta.conn_tipocon = primeraVez ? "P" : "S";
}

function agregarDiagnostico() {
  if (notaBloqueada.value) return;
  if (dxSlotsVisible.value < 3) dxSlotsVisible.value += 1;
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

function agregarAlergiaDesdeCatalogo() {
  if (notaBloqueada.value) return;
  const clave = alergiaCatalogoSel.value;
  if (!clave) return;
  let label = "";
  if (clave === "OTRO") {
    label = alergiaOtroTexto.value.trim();
    if (!label) return;
    alergiaOtroTexto.value = "";
  } else {
    label = alergiasCatalogo.value.find((a) => a.clave === clave)?.descripcion || clave;
  }
  if (!alergiasLista.value.some((a) => a.toLowerCase() === label.toLowerCase())) {
    alergiasLista.value.push(label);
  }
  alergiaCatalogoSel.value = "";
  syncAlergiasDetalleFromLista();
  syncCronicosEnAnalisis();
}

async function loadAlergiasCatalogo(q = "") {
  try {
    const data = await post<{ rows: Record<string, unknown>[] }>("/sub/catalogos/buscar", {
      ...props.session,
      tipo: "alergias",
      q,
      limit: 40,
    });
    alergiasCatalogo.value = (data.rows || []).map((r) => ({
      clave: String(r.clave || ""),
      descripcion: String(r.descripcion || r.clave || ""),
    }));
    if (!alergiasCatalogo.value.some((a) => a.clave === "OTRO")) {
      alergiasCatalogo.value.push({ clave: "OTRO", descripcion: "Otro (especificar)" });
    }
  } catch {
    alergiasCatalogo.value = [
      { clave: "PEN", descripcion: "Penicilina" },
      { clave: "ASA", descripcion: "Ácido acetilsalicílico (Aspirina)" },
      { clave: "LAT", descripcion: "Látex" },
      { clave: "OTRO", descripcion: "Otro (especificar)" },
    ];
  }
}

function quitarAlergia(idx: number) {
  if (notaBloqueada.value) return;
  alergiasLista.value.splice(idx, 1);
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
    });
  alergiasLista.value = lines;
  syncAlergiasDetalleFromLista();
}

function toggleCronico(campo: "diabetes" | "hipertension" | "obesidad" | "alergias") {
  if (notaBloqueada.value) return;
  antecedentesVisitados.value = true;
  notaCronica[campo] = notaCronica[campo] === "positivo" ? "negativo" : "positivo";
  if (campo === "alergias" && notaCronica.alergias === "negativo") {
    alergiasLista.value = [];
    alergiaNueva.value = "";
    alergiaCatalogoSel.value = "";
    alergiaOtroTexto.value = "";
    notaCronica.alergiasDetalle = "ALERGIAS NO REGISTRADAS";
  }
  if (campo === "alergias" && notaCronica.alergias === "positivo") {
    void loadAlergiasCatalogo("");
  }
  syncCronicosEnAnalisis();
}

function syncCronicosEnAnalisis() {
  if (notaBloqueada.value) return;
  const lineas = [
    `ANTECEDENTES CRONICOS: DIABETES ${notaCronica.diabetes.toUpperCase()}, ` +
      `HIPERTENSION ${notaCronica.hipertension.toUpperCase()}, ` +
      `OBESIDAD ${notaCronica.obesidad.toUpperCase()}.`,
  ];
  if (notaCronica.alergias === "positivo") {
    const det = (notaCronica.alergiasDetalle || "").trim() || "ALERGIA REFERIDA";
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
  ].join(" ");
}

const SIGNOS_PLAN_RE = /SIGNOS VITALES:[^\n]*/i;

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

const especialidadNombre = computed(
  () =>
    especialidades.value.find((e) => e.esps_espserv === Number(asignar.esps_espserv))?.espc_descrip ||
    "",
);

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
  return Number(row.cits_estatus) >= 2 || Number(row.cits_hrllegada) > 0;
}

/** Mínimo provisional (seguimiento); alinear con backend SOAP_MIN_CHARS. */
const SOAP_MIN_CHARS = 20;
const SOAP_SIGNOS_PLAN_RE = /SIGNOS VITALES:[^\n]*/i;

function soapLen(text: string, stripSignos = false): number {
  let t = (text || "").trim();
  if (stripSignos) t = t.replace(SOAP_SIGNOS_PLAN_RE, "").trim();
  return t.length;
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

function openServiciosModal() {
  if (!consulta.hosi_folio) {
    error.value = "Seleccione una cita (folio)";
    return;
  }
  serviciosModalOpen.value = true;
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
  esps_espserv: 0,
  requiere_signos: "S",
});

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
  if (citaYaLlego(selectedAgendaRow.value)) return true;
  const citaFecha = String(
    selectedAgendaRow.value.citd_fechcita || fecha.value || "",
  ).slice(0, 10);
  if (citaFecha && citaFecha > hoyIso.value) return true;
  return false;
});

const iniciarAtencionDisabled = computed(() => {
  if (!puedeClinica.value) return true;
  if (!selectedAgendaRow.value) return true;
  return !citaYaLlego(selectedAgendaRow.value);
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
  return `${dia.toUpperCase()}, ${d.getDate()} DE ${mes.toUpperCase()} DE ${d.getFullYear()} · ESPERA ${tiempoEsperaProm.value} · CONSULTA ${tiempoConsultaProm.value}`;
});

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
  return [citaStatusClass(row.cits_estatus), "siah-agenda-row", selectedAgendaFolio(row) ? "siah-agenda-row--picked" : ""];
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
  fecha.value = `${y}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
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
  if (!citaYaLlego(row)) {
    error.value = "Registre la llegada del paciente antes de iniciar la atención médica";
    okMsg.value = "";
    return;
  }
  consultaOkLocal.value = false;
  tab.value = "consulta";
  void loadConsultaContext(true);
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
  if (citaYaLlego(row)) {
    error.value = "La llegada ya fue registrada para esta cita";
    return;
  }
  await llegada(Number(row.hosi_folio));
}

function confirmarCitaSelected() {
  const row = requireSelectedAgenda("confirmar");
  if (!row) return;
  if (Number(row.cits_estatus) !== 1) {
    okMsg.value = `La cita ${row.hosi_folio} ya está confirmada o en otro estatus`;
    return;
  }
  okMsg.value = `Cita ${row.hosi_folio} confirmada (estatus inicial registrado)`;
}

function diferirCitaSelected() {
  const row = requireSelectedAgenda("diferir");
  if (!row) return;
  okMsg.value = `Diferimiento de cita ${row.hosi_folio} pendiente de implementar en API`;
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
  return "siah-agenda-row--diferido";
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
    const [esp, med] = await Promise.all([
      post<{ rows: Record<string, unknown>[] }>("/sub/atmed/especialidades", props.session),
      post<{ rows: Record<string, unknown>[] }>("/sub/atmed/medicos", {
        ...props.session,
        // Sin filtro: la especialidad la define el médico seleccionado
        esps_espserv: null,
      }),
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
    }));
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
    await post("/sub/atmed/llegada", { ...props.session, hosi_folio: folio });
    okMsg.value = "Llegada registrada";
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
  const flag = String(row.requiere_signos || "").toUpperCase();
  if (flag === "N" || flag === "S") {
    citaCtx.requiere_signos = flag;
  } else {
    const esp = especialidades.value.find((e) => e.esps_espserv === citaCtx.esps_espserv);
    citaCtx.requiere_signos = esp?.requiere_signos === "N" ? "N" : "S";
  }
  // Estatus 4 = atendida / nota grabada (legacy).
  notaBloqueada.value = Number(row.cits_estatus) === 4;
  if (consultaLoadedFolio.value !== folio) {
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
    const tipocon = String(r.conn_tipocon || "P").toUpperCase().slice(0, 1);
    consulta.conn_tipocon = tipocon || "P";
    consulta.enfermedadPrimeraVez = tipocon !== "S";
    consulta.enfermedadSub = tipocon === "S";
    dxSlotsVisible.value = [consulta.diai_clacie1, consulta.diai_clacie2, consulta.diai_clacie3].filter(
      Boolean,
    ).length || 1;
  } catch {
    /* precarga sigue siendo usable */
  }
}

async function loadConsultaContext(force = false) {
  if (!citaCtx.ficha) return;
  if (!force && consultaLoadedFolio.value === citaCtx.hosi_folio && citaCtx.hosi_folio) return;

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
    if (r.ders_empresa != null && r.ders_empresa !== "") {
      citaCtx.empresa = Number(r.ders_empresa);
    }

    const preData = pre.data || {};
    if (preData.edad) citaCtx.edad = String(preData.edad);
    if (preData.sexo) citaCtx.sexo = String(preData.sexo).startsWith("MASC") ? "M" : citaCtx.sexo;

    await loadNotaGrabada();

    if (!notaBloqueada.value) {
      consulta.sintomas = String(preData.sintomas || consulta.sintomas || "");
      const cr = (preData.cronicos as Record<string, boolean>) || {};
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
      } else {
        alergiasLista.value = [];
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
  } catch (e) {
    error.value = e instanceof Error ? e.message : "Error cargando datos del paciente";
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
  consulta.motivoCie10 = "";
  consulta.motivoConsulta = "";
  consulta.diagnosticoTexto = "";
  consulta.diagnosticoTexto2 = "";
  consulta.diagnosticoTexto3 = "";
  consulta.enfermedadPrimeraVez = true;
  consulta.enfermedadSub = false;
  consulta.conn_tipocon = "P";
  dxSlotsVisible.value = 1;
  consultaLoadedFolio.value = 0;
  notaCronica.diabetes = "negativo";
  notaCronica.hipertension = "negativo";
  notaCronica.obesidad = "negativo";
  notaCronica.alergias = "negativo";
  notaCronica.alergiasDetalle = "";
  alergiasLista.value = [];
  alergiaNueva.value = "";
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
  });
}

function openRecetaConsulta() {
  if (!consulta.hosi_folio || !citaCtx.ficha) {
    error.value = "Seleccione una cita con paciente para emitir receta";
    return;
  }
  emit("openReceta", {
    ficha: citaCtx.ficha,
    codigo: citaCtx.codigo || "00",
    empresa: citaCtx.empresa || 0,
    hosi_folio: citaCtx.hosi_folio || undefined,
    paciente: citaCtx.paciente || "",
    diagnostico: [consulta.diai_clacie1, consulta.diagnosticoTexto].filter(Boolean).join(" ").trim(),
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
    return;
  }
  if (!soapCompleto.value) {
    error.value =
      `SOAP incompleto: cada campo requiere al menos ${SOAP_MIN_CHARS} caracteres ` +
      `(Plan sin contar el bloque automático de signos). Faltan: ${soapFaltantes.value.join(", ")}`;
    return;
  }
  syncAlergiasDetalleFromLista();
  syncCronicosEnAnalisis();
  consulta.conn_tipocon = consulta.enfermedadSub ? "S" : "P";
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
    const res = await post<{ mensaje: string }>("/sub/atmed/signos", { ...props.session, ...signos });
    okMsg.value = res.mensaje;
    await loadUltimosSignos();
    const resumen = formatSignosResumenLinea(signos);
    syncSignosEnPlan(resumen);
    // Reflejar crónico hipertenso si la toma lo sugiere (solo refuerzo UI; censo manda).
    const ta = clasificacionTension(signos.tension_sis, signos.tension_dia);
    if (ta === "HIPERTENSO" && notaCronica.hipertension === "negativo") {
      notaCronica.hipertension = "positivo";
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
    await loadConsultaContext();
  }
});

onMounted(async () => {
  await load();
  await loadEmpresasCat();
  await loadCatalogos();
});
</script>

<template>
  <div class="siah-atmed-widget space-y-3">
    <UAlert v-if="error" color="error" variant="subtle" :title="error" />
    <UAlert v-if="okMsg" color="success" variant="subtle" :title="okMsg" />

    <div
      class="grid grid-cols-1 gap-2 rounded-xl border border-default bg-default p-2 min-h-[32rem]"
      :class="showAsideRail ? 'lg:grid-cols-[148px_minmax(0,1fr)]' : ''"
    >
      <aside
        v-if="showAsideRail"
        class="flex flex-col gap-1.5 border-b lg:border-b-0 lg:border-r border-default pb-2 lg:pb-0 lg:pr-2"
      >
        <template v-if="showChromeNav">
          <UButton
            v-for="nav in sidebarNav"
            :key="nav.id"
            block
            size="xs"
            :variant="sidebarTabActive === nav.id ? 'solid' : 'soft'"
            color="primary"
            @click="tab = nav.id as typeof tab"
          >
            {{ nav.label }}
          </UButton>
        </template>

        <div v-if="tab === 'agenda'" class="flex flex-col gap-1 mt-0.5">
          <UButton
            label="CONFIRMAR"
            icon="i-lucide-circle-alert"
            color="warning"
            variant="soft"
            size="xs"
            block
            :disabled="loading"
            @click="confirmarCitaSelected"
          />
          <UButton
            label="LLEGA PACIENTE"
            icon="i-lucide-check"
            color="success"
            variant="soft"
            size="xs"
            block
            :disabled="loading || llegadaDisabled"
            @click="llegadaSelected"
          />
          <UButton
            label="DIFIERE CITA"
            icon="i-lucide-x"
            color="error"
            variant="soft"
            size="xs"
            block
            :disabled="loading"
            @click="diferirCitaSelected"
          />
        </div>

        <div class="siah-mini-cal">
          <div class="siah-mini-cal-head">
            <button type="button" class="siah-cal-nav" aria-label="Mes anterior" @click="shiftCalMonth(-1)">‹</button>
            <span>{{ formatCalMonthLabel(calMonth) }}</span>
            <button type="button" class="siah-cal-nav" aria-label="Mes siguiente" @click="shiftCalMonth(1)">›</button>
          </div>
          <div class="siah-mini-cal-grid siah-mini-cal-grid--head">
            <span v-for="d in DIAS_CAL" :key="d">{{ d }}</span>
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
              }"
              :disabled="!day"
              @click="pickCalendarDay(day)"
            >
              {{ day || "" }}
            </button>
          </div>
        </div>
      </aside>

      <main class="siah-atmed-main">
        <div v-if="!showChromeNav" class="mb-2 flex flex-wrap gap-1.5">
          <UButton
            v-for="nav in sidebarNav"
            :key="`embed-${nav.id}`"
            size="xs"
            :variant="sidebarTabActive === nav.id ? 'solid' : 'soft'"
            color="primary"
            @click="tab = nav.id as typeof tab"
          >
            {{ nav.label }}
          </UButton>
        </div>
        <div v-if="tab === 'agenda'" class="siah-agenda-medica">
          <div class="siah-agenda-head">
            <div>
              <h2 class="text-sm font-bold uppercase text-primary m-0">{{ formatAgendaTitulo(fecha) }}</h2>
              <p class="text-xs text-muted mt-1 mb-0">
                TIEMPO DE ESPERA PROMEDIO {{ tiempoEsperaProm }} (HORAS:MINUTOS) · TIEMPO DE CONSULTA PROMEDIO
                {{ tiempoConsultaProm }} (HORAS:MINUTOS)
              </p>
            </div>
            <div class="flex flex-wrap items-center gap-2">
              <UButton
                label="VERIFICA CITAS"
                icon="i-lucide-refresh-cw"
                color="primary"
                size="sm"
                :loading="loading"
                @click="load"
              />
              <UButton
                label="Imprimir agenda"
                icon="i-lucide-printer"
                color="neutral"
                variant="soft"
                size="sm"
                :disabled="!rows.length"
                @click="imprimirAgenda"
              />
            </div>
          </div>

          <div class="siah-agenda-table-wrap siah-agenda-table-wrap--full">
            <table class="siah-agenda-table siah-agenda-table--medica">
              <thead>
                <tr>
                  <th>No</th>
                  <th>FOLIO</th>
                  <th>CITA</th>
                  <th>LLEGÓ</th>
                  <th>INICIO</th>
                  <th>FICHA</th>
                  <th>PACIENTE</th>
                  <th>MOTIVO DE CONSULTA</th>
                  <th>DIAGNÓSTICO DE CONSULTA</th>
                  <th class="siah-agenda-acciones-col">ACCIONES</th>
                </tr>
              </thead>
              <tbody>
                <tr v-if="loading && !rows.length">
                  <td colspan="10" class="siah-agenda-empty">Cargando…</td>
                </tr>
                <tr v-else-if="!rows.length">
                  <td colspan="10" class="siah-agenda-empty">Sin citas para esta fecha</td>
                </tr>
                <tr
                  v-for="(row, idx) in rows"
                  v-else
                  :key="String(row.hosi_folio)"
                  :class="agendaRowClasses(row)"
                  @click="selectAgendaRow(row)"
                  @dblclick="puedeClinica && openConsultaFromAgenda(row)"
                >
                  <td>{{ idx + 1 }}</td>
                  <td>{{ row.hosi_folio }}</td>
                  <td>{{ formatHoraCelda(row.citn_hrcita) }}</td>
                  <td>{{ formatHoraCelda(row.cits_hrllegada) || "—" }}</td>
                  <td>—</td>
                  <td>{{ row.derc_ficha }}</td>
                  <td class="siah-agenda-paciente">{{ row.paciente }}</td>
                  <td>{{ row.especialidad || "—" }}</td>
                  <td>—</td>
                  <td class="siah-agenda-acciones-col" @click.stop>
                    <div class="siah-agenda-acciones">
                      <button
                        type="button"
                        class="siah-agenda-acciones__btn"
                        :disabled="citaYaLlego(row) || String(row.citd_fechcita || fecha).slice(0, 10) > hoyIso"
                        title="Registrar llegada"
                        @click="selectAgendaRow(row); llegada(Number(row.hosi_folio))"
                      >
                        Llega
                      </button>
                      <button
                        v-if="puedeClinica"
                        type="button"
                        class="siah-agenda-acciones__btn"
                        :disabled="!citaYaLlego(row)"
                        title="Iniciar atención médica"
                        @click="openConsultaFromAgenda(row)"
                      >
                        Atención
                      </button>
                      <button
                        type="button"
                        class="siah-agenda-acciones__btn"
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

          <div class="flex flex-wrap items-center gap-2 pt-1">
            <UButton
              label="Ver expediente"
              variant="link"
              color="primary"
              size="sm"
              :disabled="!selectedAgendaRow"
              @click="selectedAgendaRow && openExpedienteFromAgenda(selectedAgendaRow)"
            />
            <UButton
              label="Iniciar atención médica"
              variant="link"
              color="primary"
              size="sm"
              :disabled="iniciarAtencionDisabled"
              @click="selectedAgendaRow && openConsultaFromAgenda(selectedAgendaRow)"
            />
            <span class="text-xs text-muted ml-auto">{{ rows.length }} cita(s) · unidad {{ session.unitrab }}</span>
          </div>

          <div class="siah-agenda-leyenda siah-agenda-leyenda--full">
            <span class="siah-leyenda-item siah-leyenda-item--confirmar">POR CONFIRMAR</span>
            <span class="siah-leyenda-item siah-leyenda-item--espera">EN ESPERA</span>
            <span class="siah-leyenda-item siah-leyenda-item--atendido">ATENDIDO</span>
            <span class="siah-leyenda-item siah-leyenda-item--diferido">DIFERIDO</span>
            <span class="siah-leyenda-item siah-leyenda-item--local">LOCAL</span>
            <span class="siah-leyenda-item siah-leyenda-item--foraneo">FORÁNEO</span>
            <span class="siah-leyenda-item siah-leyenda-item--tramite">TRÁMITE ADMINISTRATIVO</span>
            <span class="siah-leyenda-item siah-leyenda-item--no-atendido">NO ATENDIDO</span>
            <span class="siah-leyenda-item siah-leyenda-item--ver-todo">VER TODO</span>
          </div>
        </div>

        <div v-else-if="tab === 'asignar'" class="siah-asigna siah-asigna--flujo">
          <UAlert
            v-if="asignarOkFolio"
            color="success"
            variant="subtle"
            class="mb-2"
            :title="`Cita registrada. Folio de cita médica: ${asignarOkFolio}`"
          />

          <AtmedSectionCard title="1. Buscar paciente">
            <p v-if="buscarHint" class="siah-hint-info mb-2">{{ buscarHint }}</p>
            <div class="siah-field-row">
              <label class="siah-label">Ficha</label>
              <input
                v-model="asignar.ficha"
                class="siah-input siah-input--ficha"
                @blur="loadBeneficiariosPorFicha"
                @keydown.enter.prevent="loadPaciente"
              />
              <label class="siah-label" title="Codificación del beneficiario">Código</label>
              <select
                v-model="asignar.codigo"
                class="siah-input siah-input--cod"
                @keydown.enter.prevent="loadPaciente"
              >
                <option v-for="c in codigosOptions" :key="c.value" :value="c.value">
                  {{ c.label }}
                </option>
              </select>
              <label class="siah-label" title="Empresa / contrato">Empresa</label>
              <select
                v-model.number="asignar.empresa"
                class="siah-input siah-input--emp"
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
            </div>
            <div class="flex flex-wrap justify-end gap-2 mt-2">
              <UButton
                label="Limpiar"
                color="neutral"
                variant="outline"
                size="sm"
                :disabled="loading || asignando || paciente.loading"
                @click="limpiarAsignar"
              />
              <UButton
                label="Buscar paciente"
                icon="i-lucide-search"
                color="primary"
                size="sm"
                :loading="paciente.loading"
                @click="loadPaciente"
              />
            </div>
          </AtmedSectionCard>

          <template v-if="pacienteBuscado">
            <AtmedSectionCard title="2. Datos del paciente">
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
                    <UBadge
                      :color="pacienteVigente ? 'success' : pacienteVigenciaLabel === 'SIN DATO' ? 'neutral' : 'error'"
                      variant="subtle"
                      size="sm"
                    >
                      {{ pacienteVigenciaLabel }}
                    </UBadge>
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

            <AtmedSectionCard title="3. Datos de la nueva cita">
              <div class="siah-field-row siah-field-row--medico">
                <label class="siah-label">Médico</label>
                <select
                  v-model="asignar.medicoKey"
                  class="siah-input siah-input--grow"
                  @change="onMedicoChange"
                >
                  <option
                    v-for="m in medicos"
                    :key="medicoOptionKey(m)"
                    :value="medicoOptionKey(m)"
                  >
                    {{
                      m.medc_nombre +
                      " (" +
                      m.medc_ficha +
                      ")" +
                      (especialidades.find((e) => e.esps_espserv === m.esps_espserv)
                        ? " — " +
                          especialidades.find((e) => e.esps_espserv === m.esps_espserv)?.espc_descrip
                        : "")
                    }}
                  </option>
                </select>
              </div>
              <div class="siah-field-row siah-field-row--esp">
                <label class="siah-label">Especialidad</label>
                <input
                  class="siah-input siah-input--grow"
                  type="text"
                  readonly
                  :value="especialidadNombre || 'Se asigna según el médico'"
                  title="La especialidad corresponde al médico seleccionado"
                />
              </div>
              <div class="siah-field-row">
                <label class="siah-label">Fecha</label>
                <input
                  v-model="asignar.fecha"
                  type="date"
                  class="siah-input siah-input--fecha"
                  :min="hoyIso"
                />
                <label class="siah-label">Hora</label>
                <select v-model.number="asignar.hora" class="siah-input siah-input--hora">
                  <option v-if="!horas.length" :value="0" disabled>Sin horarios disponibles</option>
                  <option v-for="h in horas" :key="h.hora" :value="h.hora">{{ h.label }}</option>
                </select>
              </div>
              <div class="siah-field-row siah-field-row--obs">
                <label class="siah-label siah-label--top">Observaciones</label>
                <textarea v-model="asignar.observaciones" class="siah-textarea" rows="3" />
              </div>
              <UAlert
                v-if="citaDuplicadaDia"
                color="error"
                variant="subtle"
                class="mt-2"
                :title="`No se puede confirmar: el paciente ya tiene cita el mismo día (${citaDuplicadaMsg}).`"
              />
            </AtmedSectionCard>

            <AtmedSectionCard title="4. Revisar y confirmar">
              <div class="siah-asigna-resumen">
                <div>
                    <span class="siah-meta-label">Paciente</span>
                  <p class="siah-asigna-resumen__val">
                    {{ paciente.nombre || "—" }}<span v-if="paciente.edad"> · {{ paciente.edad }} años</span>
                  </p>
                </div>
                <div>
                  <span class="siah-meta-label">Especialidad</span>
                  <p class="siah-asigna-resumen__val">{{ especialidadNombre || "—" }}</p>
                </div>
                <div>
                  <span class="siah-meta-label">Médico</span>
                  <p class="siah-asigna-resumen__val">{{ medicoNombre || "—" }}</p>
                </div>
                <div>
                  <span class="siah-meta-label">Fecha</span>
                  <p class="siah-asigna-resumen__val">{{ formatFechaDisplay(asignar.fecha) || "—" }}</p>
                </div>
                <div>
                  <span class="siah-meta-label">Hora</span>
                  <p class="siah-asigna-resumen__val">{{ horaLabel || "—" }}</p>
                </div>
                <div>
                  <span class="siah-meta-label">Folio</span>
                  <p class="siah-asigna-resumen__val">
                    {{ asignarOkFolio || "Se genera al confirmar" }}
                  </p>
                </div>
              </div>
              <div class="flex flex-wrap justify-end gap-2 mt-3">
                <UButton
                  label="Cancelar"
                  color="neutral"
                  variant="outline"
                  size="sm"
                  :disabled="asignando"
                  @click="limpiarAsignar"
                />
                <UButton
                  label="Confirmar cita"
                  color="primary"
                  size="sm"
                  :loading="asignando"
                  :disabled="!puedeConfirmarCita || asignando"
                  @click="doAsignar"
                />
              </div>
            </AtmedSectionCard>
          </template>
        </div>

        <div v-else-if="tab === 'consulta'" class="flex flex-col gap-3 min-w-0">
          <p class="text-xs font-semibold uppercase text-primary m-0">{{ consultaStatusLine }}</p>

          <div class="flex flex-wrap items-center gap-2">
            <UButton
              :label="signosPanelOpen ? 'Ocultar signos' : 'SIGNOS VITALES'"
              color="primary"
              :variant="consultaBloqueadaSinSignos ? 'solid' : 'soft'"
              size="sm"
              :disabled="!consulta.hosi_folio"
              @click="signosPanelOpen = !signosPanelOpen"
            />
            <UButton
              label="Ampliar signos"
              color="neutral"
              variant="outline"
              size="sm"
              :disabled="!consulta.hosi_folio"
              @click="openSignosModal"
            />
            <UBadge
              :color="antecedentesVisitados ? 'success' : 'neutral'"
              variant="subtle"
              size="sm"
            >
              Antecedentes {{ antecedentesVisitados ? "OK" : "pendiente" }}
            </UBadge>
            <UBadge
              :color="!consultaRequiereSignos || consultaTieneSignos ? 'success' : 'warning'"
              variant="subtle"
              size="sm"
            >
              Signos
              {{
                !consultaRequiereSignos
                  ? "N/A"
                  : consultaTieneSignos
                    ? "OK"
                    : "pendiente"
              }}
            </UBadge>
          </div>

          <AtmedSectionCard v-if="signosPanelOpen && consulta.hosi_folio" title="Signos vitales (en consulta)">
            <div class="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              <UFormField label="Pulso *"><UInput v-model="signos.pulso" size="sm" inputmode="numeric" /></UFormField>
              <UFormField label="Resp *"><UInput v-model="signos.respiracion" size="sm" inputmode="numeric" /></UFormField>
              <UFormField label="TA sis *"><UInput v-model="signos.tension_sis" size="sm" inputmode="numeric" /></UFormField>
              <UFormField label="TA dia *"><UInput v-model="signos.tension_dia" size="sm" inputmode="numeric" /></UFormField>
              <UFormField label="Temp *"><UInput v-model="signos.temperatura" size="sm" inputmode="decimal" /></UFormField>
              <UFormField label="Peso *"><UInput v-model="signos.peso" size="sm" inputmode="decimal" /></UFormField>
              <UFormField label="Estatura *"><UInput v-model="signos.estatura" size="sm" inputmode="decimal" /></UFormField>
              <UFormField label="Abdominal"><UInput v-model="signos.abdominal" size="sm" inputmode="decimal" /></UFormField>
            </div>
            <p v-if="signosImc != null" class="text-xs m-0 mt-2">
              IMC: <strong>{{ signosImc }}</strong>
              <span v-if="signosClasificacion"> · {{ signosClasificacion }}</span>
              <span v-if="signosTensionClasificacion"> · TA {{ signosTensionClasificacion }}</span>
            </p>
            <UAlert
              v-if="signosPercentilPeds?.etiqueta"
              color="info"
              variant="subtle"
              class="mt-2"
              :title="`Percentil pediátrico (edad ${edadConsultaNum} a.): ${signosPercentilPeds.etiqueta}`"
              :description="`Estimación orientativa (P${signosPercentilPeds.percentilAprox}). Validar con curvas oficiales.`"
            />
            <div class="flex flex-wrap justify-end gap-2 mt-2">
              <UButton
                label="Copiar últimos"
                size="sm"
                color="neutral"
                variant="outline"
                :disabled="!ultimosSignos"
                @click="copiarUltimosSignos"
              />
              <UButton
                label="Grabar signos vitales"
                size="sm"
                color="primary"
                :loading="loading"
                @click="doSignos"
              />
            </div>
          </AtmedSectionCard>

          <UAlert
            v-if="consultaBloqueadaSinSignos"
            color="warning"
            variant="subtle"
            title="Signos vitales requeridos"
            description="Esta especialidad exige registrar signos del folio antes de capturar Síntomas/Objetivo y grabar la nota clínica (odontología y excepciones quedan exentas)."
          />

          <UAlert
            v-if="signosResumenConsulta"
            color="info"
            variant="subtle"
            title="Signos vitales en la consulta"
            :description="signosResumenConsulta"
          />

          <UAlert
            v-if="recetasResumenConsulta"
            color="primary"
            variant="subtle"
            title="Recetas de este folio (consulta, sin reescribir la nota)"
            :description="recetasResumenConsulta"
          />

          <UAlert
            v-if="!consulta.hosi_folio"
            color="neutral"
            variant="subtle"
            title="Seleccione una cita en la agenda (doble clic) para iniciar la consulta."
          />

          <template v-else>
            <div class="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_92px] gap-2">
              <div class="overflow-x-auto rounded-lg border border-default">
                <table class="w-full text-[0.65rem] border-collapse">
                  <thead>
                    <tr class="bg-inverted text-inverted">
                      <th class="px-2 py-1 text-left font-bold whitespace-nowrap">CITA</th>
                      <th class="px-2 py-1 text-left font-bold whitespace-nowrap">INICIO</th>
                      <th class="px-2 py-1 text-left font-bold whitespace-nowrap">TERMINO</th>
                      <th class="px-2 py-1 text-left font-bold whitespace-nowrap">NO FOLIO</th>
                      <th class="px-2 py-1 text-left font-bold whitespace-nowrap">FICHA</th>
                      <th class="px-2 py-1 text-left font-bold whitespace-nowrap">COD</th>
                      <th class="px-2 py-1 text-left font-bold whitespace-nowrap">EMP</th>
                      <th class="px-2 py-1 text-left font-bold whitespace-nowrap">NOMBRE</th>
                      <th class="px-2 py-1 text-left font-bold whitespace-nowrap">PROCEDENCIA</th>
                      <th class="px-2 py-1 text-left font-bold whitespace-nowrap">EDAD</th>
                      <th class="px-2 py-1 text-left font-bold whitespace-nowrap">SEXO</th>
                      <th class="px-2 py-1 text-left font-bold whitespace-nowrap">SANGRE</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr class="border-t border-default">
                      <td class="px-2 py-1">{{ formatHora(citaCtx.horaCita) || "—" }}</td>
                      <td class="px-2 py-1">{{ formatHoraCelda(citaCtx.horaInicio) || "—" }}</td>
                      <td class="px-2 py-1">{{ formatHoraCelda(citaCtx.horaTermino) || "—" }}</td>
                      <td class="px-2 py-1">{{ citaCtx.hosi_folio }}</td>
                      <td class="px-2 py-1">{{ citaCtx.ficha }}</td>
                      <td class="px-2 py-1">{{ citaCtx.codigo }}</td>
                      <td class="px-2 py-1">{{ citaCtx.empresa }}</td>
                      <td class="px-2 py-1 font-bold uppercase">{{ citaCtx.paciente }}</td>
                      <td
                        class="px-2 py-1"
                        :class="{ 'text-error font-bold': citaCtx.procedencia.toUpperCase().includes('FOR') }"
                      >
                        {{ citaCtx.procedencia || "—" }}
                      </td>
                      <td class="px-2 py-1">{{ citaCtx.edad || "—" }}</td>
                      <td class="px-2 py-1">{{ citaCtx.sexo || "—" }}</td>
                      <td class="px-2 py-1">{{ citaCtx.sangre || "—" }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <div class="self-stretch">
                <img
                  v-if="consultaPhotoUrl && !consultaPhotoFailed"
                  :src="consultaPhotoUrl"
                  alt="Foto del paciente"
                  class="w-full min-h-[88px] max-w-[120px] md:max-w-none object-cover rounded-lg border border-default bg-elevated"
                  @error="consultaPhotoFailed = true"
                />
                <div
                  v-else
                  class="flex items-center justify-center w-full min-h-[88px] max-w-[120px] md:max-w-none rounded-lg border border-default bg-elevated text-[0.65rem] font-bold text-muted"
                >
                  SIN FOTO
                </div>
              </div>
            </div>

            <AtmedSectionCard title="Enfermedad crónico degenerativa">
              <p class="text-[0.7rem] text-muted m-0 mb-2">
                Prellenado desde censo. Pulse el badge para marcar positivo/negativo (se refleja en
                Análisis). Las alergias positivas se capturan como lista al grabar la consulta.
                <span v-if="notaBloqueada" class="font-semibold text-warning"> Nota grabada: solo lectura.</span>
              </p>
              <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <button
                  type="button"
                  class="flex flex-col items-center gap-1 rounded-lg border border-default p-2 hover:bg-elevated"
                  :disabled="notaBloqueada"
                  @click="toggleCronico('diabetes')"
                >
                  <span class="text-xs font-bold text-muted">DIABETES</span>
                  <UBadge
                    :color="notaCronica.diabetes === 'positivo' ? 'error' : 'success'"
                    variant="subtle"
                    size="sm"
                  >
                    {{ notaCronica.diabetes === "positivo" ? "POSITIVO" : "NEGATIVO" }}
                  </UBadge>
                </button>
                <button
                  type="button"
                  class="flex flex-col items-center gap-1 rounded-lg border border-default p-2 hover:bg-elevated"
                  :disabled="notaBloqueada"
                  @click="toggleCronico('hipertension')"
                >
                  <span class="text-xs font-bold text-muted">HIPERTENSIÓN</span>
                  <UBadge
                    :color="notaCronica.hipertension === 'positivo' ? 'error' : 'success'"
                    variant="subtle"
                    size="sm"
                  >
                    {{ notaCronica.hipertension === "positivo" ? "POSITIVO" : "NEGATIVO" }}
                  </UBadge>
                </button>
                <button
                  type="button"
                  class="flex flex-col items-center gap-1 rounded-lg border border-default p-2 hover:bg-elevated"
                  :disabled="notaBloqueada"
                  @click="toggleCronico('obesidad')"
                >
                  <span class="text-xs font-bold text-muted">OBESIDAD</span>
                  <UBadge
                    :color="notaCronica.obesidad === 'positivo' ? 'error' : 'success'"
                    variant="subtle"
                    size="sm"
                  >
                    {{ notaCronica.obesidad === "positivo" ? "POSITIVO" : "NEGATIVO" }}
                  </UBadge>
                </button>
                <button
                  type="button"
                  class="flex flex-col items-center gap-1 rounded-lg border border-default p-2 hover:bg-elevated"
                  :disabled="notaBloqueada"
                  @click="toggleCronico('alergias')"
                >
                  <span class="text-xs font-bold text-muted">ALERGIAS</span>
                  <UBadge
                    :color="notaCronica.alergias === 'positivo' ? 'error' : 'success'"
                    variant="subtle"
                    size="sm"
                  >
                    {{ notaCronica.alergias === "positivo" ? "POSITIVO" : "NEGATIVO" }}
                  </UBadge>
                </button>
              </div>
              <div v-if="notaCronica.alergias === 'positivo'" class="mt-3 space-y-2">
                <p class="text-[0.7rem] font-semibold text-muted m-0">Detalle de alergias (catálogo)</p>
                <div class="flex flex-wrap items-end gap-2">
                  <UFormField label="Alérgeno" class="min-w-[14rem] flex-1" :ui="notaFieldUi">
                    <select
                      v-model="alergiaCatalogoSel"
                      class="siah-input w-full"
                      :disabled="notaBloqueada"
                      @focus="loadAlergiasCatalogo('')"
                    >
                      <option value="">Seleccione…</option>
                      <option
                        v-for="a in alergiasCatalogo"
                        :key="a.clave"
                        :value="a.clave"
                      >
                        {{ a.descripcion }}
                      </option>
                    </select>
                  </UFormField>
                  <UFormField
                    v-if="alergiaCatalogoSel === 'OTRO'"
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
                    />
                  </UFormField>
                  <UButton
                    label="Agregar"
                    color="primary"
                    size="sm"
                    :disabled="
                      notaBloqueada ||
                      !alergiaCatalogoSel ||
                      (alergiaCatalogoSel === 'OTRO' && !alergiaOtroTexto.trim())
                    "
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
                  Seleccione del catálogo o use «Otro» para texto libre.
                </p>
              </div>
            </AtmedSectionCard>

            <AtmedSectionCard title="Motivo de consulta">
              <p class="text-[0.7rem] text-muted m-0 mb-2">
                Autocomplete CIE-10 (≥2 caracteres). No se carga el catálogo completo al cliente.
              </p>
              <div class="grid w-full gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] sm:items-start">
                <CatalogAutocomplete
                  :api-base="apiBase"
                  :api-prefix="apiPrefix"
                  :session="session"
                  tipo="cie10"
                  label="Buscar CIE-10 (motivo)"
                  placeholder="Clave o descripción…"
                  :disabled="notaBloqueada"
                  @select="onPickCieMotivo"
                />
                <div class="grid gap-2 sm:grid-cols-[7rem_minmax(0,1fr)]">
                  <UFormField label="CIE-10" class="w-full" :ui="notaFieldUi">
                    <UInput
                      v-model="consulta.motivoCie10"
                      maxlength="5"
                      size="sm"
                      class="w-full uppercase"
                      :disabled="notaBloqueada"
                    />
                  </UFormField>
                  <UFormField label="Motivo de consulta" class="w-full min-w-0" :ui="notaFieldUi">
                    <UInput
                      v-model="consulta.motivoConsulta"
                      size="sm"
                      class="w-full min-w-0"
                      :disabled="notaBloqueada"
                    />
                  </UFormField>
                </div>
              </div>
            </AtmedSectionCard>

            <AtmedSectionCard title="Nota clínica">
              <p class="text-[0.7rem] text-muted m-0 mb-2">
                Mínimo {{ SOAP_MIN_CHARS }} caracteres en Síntomas, Objetivo, Análisis y Plan.
                En Plan puede escribir al inicio o al final; el bloque de una línea
                <code>SIGNOS VITALES:…</code> no cuenta para el mínimo.
                <span v-if="notaBloqueada" class="font-semibold text-warning"> Solo lectura.</span>
              </p>
              <p
                v-if="soapBloqueadoSinSignos"
                class="text-[0.7rem] text-warning font-semibold m-0 mb-2"
              >
                Capture signos vitales antes de editar Síntomas y Objetivo.
              </p>
              <div class="siah-nota-fields grid w-full gap-4 lg:grid-cols-2">
                <UFormField
                  label="Síntomas o subjetivo"
                  class="w-full min-w-0"
                  :ui="notaFieldUi"
                  :hint="soapHint(soapLens.sintomas)"
                  :error="soapLens.sintomas < SOAP_MIN_CHARS ? `Mínimo ${SOAP_MIN_CHARS} caracteres` : undefined"
                >
                  <UTextarea
                    v-model="consulta.sintomas"
                    :rows="5"
                    autoresize
                    class="w-full"
                    :ui="notaTextareaUi"
                    :disabled="notaBloqueada || soapBloqueadoSinSignos"
                  />
                </UFormField>
                <UFormField
                  label="Objetivo"
                  class="w-full min-w-0"
                  :ui="notaFieldUi"
                  :hint="soapHint(soapLens.objetivo)"
                  :error="soapLens.objetivo < SOAP_MIN_CHARS ? `Mínimo ${SOAP_MIN_CHARS} caracteres` : undefined"
                >
                  <UTextarea
                    v-model="consulta.objetivo"
                    :rows="5"
                    autoresize
                    class="w-full"
                    :ui="notaTextareaUi"
                    :disabled="notaBloqueada || soapBloqueadoSinSignos"
                  />
                </UFormField>
                <UFormField
                  label="Análisis"
                  class="w-full min-w-0"
                  :ui="notaFieldUi"
                  :hint="soapHint(soapLens.analisis)"
                  :error="soapLens.analisis < SOAP_MIN_CHARS ? `Mínimo ${SOAP_MIN_CHARS} caracteres` : undefined"
                >
                  <UTextarea
                    v-model="consulta.analisis"
                    :rows="5"
                    autoresize
                    class="w-full"
                    :ui="notaTextareaUi"
                    :disabled="notaBloqueada"
                  />
                </UFormField>
                <UFormField
                  label="Plan"
                  class="w-full min-w-0"
                  :ui="notaFieldUi"
                  :hint="soapHint(soapLens.plan)"
                  :error="soapLens.plan < SOAP_MIN_CHARS ? `Mínimo ${SOAP_MIN_CHARS} caracteres (sin signos auto)` : undefined"
                >
                  <UTextarea
                    v-model="consulta.plan"
                    :rows="5"
                    autoresize
                    class="w-full"
                    :ui="notaTextareaUi"
                    :disabled="notaBloqueada"
                  />
                </UFormField>
              </div>
            </AtmedSectionCard>

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
                  <span class="text-xs font-bold text-muted pb-2">ENFERMEDAD</span>
                  <UCheckbox
                    :model-value="consulta.enfermedadPrimeraVez"
                    label="1a VEZ"
                    :disabled="notaBloqueada"
                    @update:model-value="(v) => v && setTipoConsulta(true)"
                  />
                  <UCheckbox
                    :model-value="consulta.enfermedadSub"
                    label="SUB."
                    :disabled="notaBloqueada"
                    @update:model-value="(v) => v && setTipoConsulta(false)"
                  />
                  <UButton
                    icon="i-lucide-plus"
                    color="primary"
                    variant="soft"
                    size="sm"
                    title="Agregar diagnóstico (máx. 3)"
                    :disabled="notaBloqueada || dxSlotsVisible >= 3"
                    @click="agregarDiagnostico"
                  />
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

            <AtmedSectionCard title="Acciones complementarias">
              <div class="flex flex-wrap gap-2">
                <UButton
                  label="RECETA"
                  color="primary"
                  variant="soft"
                  size="sm"
                  icon="i-lucide-pill"
                  :disabled="!consulta.hosi_folio"
                  @click="openRecetaConsulta"
                />
                <UButton
                  label="CONSULTAR SOLICITUDES"
                  color="primary"
                  variant="soft"
                  size="sm"
                  icon="i-lucide-flask-conical"
                  :disabled="!consulta.hosi_folio"
                  title="Solo consulta; el alta es por forma 11-5"
                  @click="openServiciosModal"
                />
                <UButton
                  label="EXPEDIENTE"
                  color="neutral"
                  variant="outline"
                  size="sm"
                  icon="i-lucide-folder-open"
                  :disabled="!citaCtx.ficha"
                  @click="openExpedienteConsulta"
                />
                <UButton
                  label="Plan Nutricional"
                  color="success"
                  variant="soft"
                  size="sm"
                  disabled
                  title="Próximamente"
                />
              </div>
            </AtmedSectionCard>

            <UAlert
              v-if="consultaOkLocal || notaBloqueada"
              color="success"
              variant="subtle"
              class="sticky bottom-2 z-10"
              title="Consulta guardada — la nota queda en solo lectura."
            />

            <div class="flex justify-end gap-2 pt-1">
              <UButton
                label="LIMPIAR"
                color="neutral"
                variant="outline"
                size="sm"
                :disabled="notaBloqueada"
                @click="limpiarConsulta"
              />
              <UButton
                label="GRABA CONSULTA"
                color="primary"
                size="sm"
                :loading="loading"
                :disabled="consultaBloqueadaSinSignos || !soapCompleto || notaBloqueada"
                @click="doConsulta"
              />
            </div>
          </template>
        </div>
      </main>
    </div>

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
}

.siah-agenda-row--espera .siah-agenda-paciente {
  color: #0a6b0a;
}

.siah-agenda-row--picked td {
  outline: 2px solid #e67e22;
  outline-offset: -2px;
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
  gap: 0.75rem;
  max-width: 960px;
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
  gap: 0.75rem;
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
  font-size: 0.95rem;
  font-weight: 700;
  color: #111;
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
  border: 1px solid #888;
}

.siah-agenda-acciones-col {
  position: sticky;
  right: 0;
  z-index: 2;
  background: inherit;
  box-shadow: -4px 0 6px -4px rgba(0, 0, 0, 0.25);
  white-space: nowrap;
}

thead .siah-agenda-acciones-col {
  background: var(--ui-primary, #0aa7d6);
  z-index: 3;
}

.siah-agenda-acciones {
  display: flex;
  flex-wrap: nowrap;
  gap: 0.2rem;
}

.siah-agenda-acciones__btn {
  font-size: 0.62rem;
  font-weight: 700;
  padding: 0.15rem 0.35rem;
  border: 1px solid #888;
  border-radius: 0.25rem;
  background: #fff;
  cursor: pointer;
  color: #0a4a6e;
}

.siah-agenda-row--confirmar .siah-agenda-acciones-col {
  background: #ffe5e5;
}

.siah-agenda-row--espera .siah-agenda-acciones-col {
  background: #e8f7e8;
}

.siah-agenda-row--atendido .siah-agenda-acciones-col {
  background: #dceeff;
}

.siah-agenda-row--diferido .siah-agenda-acciones-col {
  background: #fff3cd;
}

.siah-agenda-table td.siah-agenda-acciones-col {
  background: #fff;
}

.siah-agenda-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.68rem;
}

.siah-agenda-table th {
  background: var(--ui-primary, #0aa7d6);
  color: #fff;
  font-weight: 700;
  text-align: left;
  padding: 0.3rem 0.35rem;
  border: 1px solid color-mix(in srgb, var(--ui-primary, #0aa7d6) 80%, #000);
  white-space: nowrap;
}

.siah-agenda-table td {
  padding: 0.25rem 0.35rem;
  border: 1px solid #ccc;
  vertical-align: middle;
}

.siah-agenda-row {
  cursor: default;
}

.siah-agenda-row--confirmar td {
  background: #ffe5e5;
  color: #111;
}

.siah-agenda-row--espera td {
  background: #e8f7e8;
  color: #0a6b0a;
  font-weight: 600;
}

.siah-agenda-row--atendido td {
  background: #e3eefb;
  color: #0a3d91;
}

.siah-agenda-row--diferido td {
  background: #f0e0e8;
  color: #6b2038;
}

.siah-agenda-empty {
  text-align: center;
  color: #666;
  padding: 1rem !important;
}

.siah-agenda-leyenda {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
  margin-top: 0.45rem;
}

.siah-leyenda-item {
  font-size: 0.58rem;
  font-weight: 700;
  padding: 0.15rem 0.35rem;
  border: 1px solid #999;
}

.siah-leyenda-item--confirmar {
  background: #ffe5e5;
  color: #900;
}

.siah-leyenda-item--espera {
  background: #e8f7e8;
  color: #0a6b0a;
}

.siah-leyenda-item--atendido {
  background: #e3eefb;
  color: #0a3d91;
}

.siah-leyenda-item--diferido {
  background: #f0e0e8;
  color: #6b2038;
}
</style>
