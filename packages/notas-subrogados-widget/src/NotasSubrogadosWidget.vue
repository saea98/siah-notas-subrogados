<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from "vue";
import AtmedSectionCard from "./components/AtmedSectionCard.vue";
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
    session: { usuario: string; password: string; unitrab: string };
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

const asignar = reactive({
  ficha: "100001",
  codigo: "00",
  empresa: 0,
  esps_espserv: 101,
  medc_ficha: "900002",
  medc_codigo: "00",
  fecha: new Date().toISOString().slice(0, 10),
  hora: 900,
  folioConsulta: "",
  observaciones: "",
});

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

const sidebarNav = [
  { id: "agenda", label: "AGENDA MEDICA" },
  { id: "asignar", label: "ASIGNA CITA" },
  { id: "consulta", label: "CONSULTA" },
] as const;

const consulta = reactive({
  hosi_folio: 0,
  sintomas: "",
  objetivo: "",
  analisis: "",
  plan: "",
  diai_clacie1: "",
  motivoCie10: "",
  motivoConsulta: "",
  diagnosticoTexto: "",
  enfermedadPrimeraVez: false,
  enfermedadSub: false,
});

const notaCronica = reactive({
  diabetes: "negativo" as "negativo" | "positivo",
  hipertension: "negativo" as "negativo" | "positivo",
  alergias: "negativo" as "negativo" | "positivo",
});

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

const SIGNOS_PLAN_RE =
  /SIGNOS VITALES:[\s\S]*?(?=\n(?:RECETA|SOLICITUD|PROCEDIMIENTO)|$)/i;

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
    consulta.plan = `${plan}\n\n${block}`.trim();
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
  tab.value = "consulta";
  void loadConsultaContext(true);
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
    clearPaciente();
    return;
  }
  paciente.loading = true;
  error.value = "";
  try {
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
    paciente.estatusVigencia = String(r.estatus_desc || r.ders_estatus || "");
    paciente.edad = calcEdad(String(r.derd_fecnac || ""));
    if (r.ders_empresa != null && r.ders_empresa !== "") {
      asignar.empresa = Number(r.ders_empresa);
    }
    photoFailed.value = false;
  } catch (e) {
    clearPaciente();
    error.value = e instanceof Error ? e.message : "Paciente no encontrado";
  } finally {
    paciente.loading = false;
  }
}

function limpiarAsignar() {
  asignar.folioConsulta = "";
  asignar.observaciones = "";
  clearPaciente();
  error.value = "";
  okMsg.value = "";
}

async function loadAgendaAsignar() {
  fecha.value = asignar.fecha;
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
      requiere_signos: String(r.requiere_signos || "S").toUpperCase() === "N" ? "N" : "S",
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
      ficha: asignar.ficha,
      codigo: asignar.codigo,
      empresa: asignar.empresa,
      esps_espserv: asignar.esps_espserv,
      medc_ficha: asignar.medc_ficha,
      medc_codigo: asignar.medc_codigo,
      fecha: asignar.fecha,
      hora: asignar.hora,
      mensaje: asignar.observaciones,
    });
    okMsg.value = res.mensaje + (res.record ? ` · folio ${res.record.hosi_folio}` : "");
    if (res.record?.hosi_folio) asignar.folioConsulta = String(res.record.hosi_folio);
    fecha.value = asignar.fecha;
    await loadAgendaAsignar();
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
  if (consultaLoadedFolio.value !== folio) {
    consultaLoadedFolio.value = 0;
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

    consulta.sintomas = String(preData.sintomas || consulta.sintomas || "");
    const cr = (preData.cronicos as Record<string, boolean>) || {};
    notaCronica.diabetes = cr.diabetes ? "positivo" : "negativo";
    notaCronica.hipertension = cr.hipertension ? "positivo" : "negativo";
    const alergiasTxt = String(preData.analisis || "");
    notaCronica.alergias = alergiasTxt && !alergiasTxt.includes("NO REGISTRADAS") ? "positivo" : "negativo";

    consultaLoadedFolio.value = citaCtx.hosi_folio;
    await loadUltimosSignos();
    if (ultimosSignos.value && !SIGNOS_PLAN_RE.test(consulta.plan || "")) {
      syncSignosEnPlan(formatSignosResumenLinea(ultimosSignos.value));
    }
    await loadRecetasConsulta();
  } catch (e) {
    error.value = e instanceof Error ? e.message : "Error cargando datos del paciente";
  }
}

function limpiarConsulta() {
  consulta.sintomas = "";
  consulta.objetivo = "";
  consulta.analisis = "";
  consulta.plan = "";
  consulta.diai_clacie1 = "";
  consulta.motivoCie10 = "";
  consulta.motivoConsulta = "";
  consulta.diagnosticoTexto = "";
  consulta.enfermedadPrimeraVez = false;
  consulta.enfermedadSub = false;
  consultaLoadedFolio.value = 0;
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

async function doConsulta() {
  if (!consulta.hosi_folio) {
    error.value = "Seleccione una cita (folio)";
    return;
  }
  if (consultaBloqueadaSinSignos.value) {
    error.value =
      "Esta especialidad exige signos vitales antes de grabar la nota. Abra SIGNOS VITALES primero.";
    return;
  }
  loading.value = true;
  error.value = "";
  try {
    const res = await post<{ mensaje: string }>("/sub/atmed/consulta", { ...props.session, ...consulta });
    okMsg.value = res.mensaje;
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
  () => [asignar.esps_espserv, asignar.medc_ficha, asignar.fecha],
  () => {
    if (tab.value === "asignar") loadCatalogos();
  },
);

watch(
  () => asignar.fecha,
  () => {
    if (tab.value === "asignar") loadAgendaAsignar();
  },
);

watch(
  () => [asignar.ficha, asignar.codigo],
  () => {
    if (tab.value === "asignar") loadPaciente();
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
  if (t === "asignar") {
    asignar.fecha = fecha.value;
    await loadAgendaAsignar();
    await loadPaciente();
  }
  if (t === "consulta") {
    await loadConsultaContext();
  }
});

onMounted(async () => {
  await load();
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
            :disabled="loading"
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
            <UButton
              label="VERIFICA CITAS"
              icon="i-lucide-refresh-cw"
              color="primary"
              size="sm"
              :loading="loading"
              @click="load"
            />
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
                </tr>
              </thead>
              <tbody>
                <tr v-if="loading && !rows.length">
                  <td colspan="9" class="siah-agenda-empty">Cargando…</td>
                </tr>
                <tr v-else-if="!rows.length">
                  <td colspan="9" class="siah-agenda-empty">Sin citas para esta fecha</td>
                </tr>
                <tr
                  v-for="(row, idx) in rows"
                  v-else
                  :key="String(row.hosi_folio)"
                  :class="agendaRowClasses(row)"
                  @click="selectAgendaRow(row)"
                  @dblclick="openConsultaFromAgenda(row)"
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
              label="Abrir consulta"
              variant="link"
              color="primary"
              size="sm"
              :disabled="!selectedAgendaRow"
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

        <div v-else-if="tab === 'asignar'" class="siah-asigna">
      <div class="siah-asigna-layout">
        <!-- Formulario izquierdo -->
        <section class="siah-asigna-form">
          <div class="flex justify-end gap-2 mb-3">
            <UButton label="LIMPIAR" color="neutral" variant="outline" size="sm" :disabled="loading" @click="limpiarAsignar" />
            <UButton label="GRABA CITA" color="primary" size="sm" :loading="loading" @click="doAsignar" />
          </div>

          <div class="siah-field-row siah-field-row--esp">
            <label class="siah-label siah-label--sm">CLAVE</label>
            <input
              v-model.number="asignar.esps_espserv"
              type="number"
              class="siah-input siah-input--clave"
              @change="loadCatalogos"
            />
            <label class="siah-label">ESPECIALIDAD</label>
            <select
              v-model.number="asignar.esps_espserv"
              class="siah-input siah-input--grow"
              @change="loadCatalogos"
            >
              <option v-for="e in especialidades" :key="e.esps_espserv" :value="e.esps_espserv">
                {{ e.espc_descrip }}
              </option>
            </select>
          </div>

          <div class="siah-field-row">
            <label class="siah-label">SELECCIONE FECHA</label>
            <input v-model="asignar.fecha" type="date" class="siah-input siah-input--fecha" />
            <label class="siah-label">SELECCIONE HORA</label>
            <select v-model.number="asignar.hora" class="siah-input siah-input--hora">
              <option v-for="h in horas" :key="h.hora" :value="h.hora">{{ h.label }} HRS.</option>
            </select>
          </div>

          <div class="siah-field-row siah-field-row--medico">
            <label class="siah-label">MÉDICO</label>
            <select
              v-model="asignar.medc_ficha"
              class="siah-input siah-input--grow"
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
          </div>

          <div class="siah-paciente-block">
            <div class="siah-paciente-fields">
              <div class="siah-field-row">
                <label class="siah-label siah-label--sm">FICHA</label>
                <input v-model="asignar.ficha" class="siah-input siah-input--ficha" @blur="loadPaciente" />
                <label class="siah-label siah-label--xs">COD</label>
                <input v-model="asignar.codigo" class="siah-input siah-input--cod" @blur="loadPaciente" />
                <label class="siah-label siah-label--xs">EMP</label>
                <input
                  v-model.number="asignar.empresa"
                  type="number"
                  class="siah-input siah-input--emp"
                  @blur="loadPaciente"
                />
                <label class="siah-label">NOMBRE</label>
                <input
                  :value="paciente.nombre"
                  readonly
                  class="siah-input siah-input--grow siah-input--readonly"
                  placeholder="—"
                />
              </div>

              <div class="siah-meta-grid">
                <div class="siah-meta-item">
                  <span class="siah-meta-label">CT</span>
                  <input :value="paciente.ct" readonly class="siah-input siah-input--meta" />
                </div>
                <div class="siah-meta-item">
                  <span class="siah-meta-label">DEPTO</span>
                  <input :value="paciente.depto" readonly class="siah-input siah-input--meta" />
                </div>
                <div class="siah-meta-item">
                  <span class="siah-meta-label">ORG</span>
                  <input :value="paciente.org" readonly class="siah-input siah-input--meta" />
                </div>
                <div class="siah-meta-item">
                  <span class="siah-meta-label">EDAD</span>
                  <input :value="paciente.edad" readonly class="siah-input siah-input--meta" />
                </div>
                <div class="siah-meta-item">
                  <span class="siah-meta-label">SX</span>
                  <input :value="paciente.sx" readonly class="siah-input siah-input--meta" />
                </div>
                <div class="siah-meta-item">
                  <span class="siah-meta-label">RC</span>
                  <input :value="paciente.rc" readonly class="siah-input siah-input--meta" />
                </div>
                <div class="siah-meta-item">
                  <span class="siah-meta-label">UMA</span>
                  <input :value="paciente.uma" readonly class="siah-input siah-input--meta" />
                </div>
              </div>

              <div class="siah-field-row">
                <label class="siah-label">UMA DESCRI</label>
                <input
                  :value="paciente.umaDescri"
                  readonly
                  class="siah-input siah-input--grow siah-input--readonly"
                  placeholder="—"
                />
              </div>

              <div class="siah-field-row siah-field-row--vigencia">
                <label class="siah-label">PROCEDENCIA</label>
                <input
                  :value="paciente.procedencia"
                  readonly
                  class="siah-input siah-input--procedencia siah-input--readonly"
                />
                <label class="siah-label">VIGENCIA</label>
                <input
                  :value="formatFechaDisplay(paciente.vigencia)"
                  readonly
                  class="siah-input siah-input--vigencia siah-input--readonly"
                />
                <label class="siah-label siah-label--wrap">ESTADO DE VIGENCIA</label>
                <input
                  :value="paciente.estatusVigencia"
                  readonly
                  class="siah-input siah-input--estatus siah-input--readonly"
                />
              </div>
            </div>

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
          </div>

          <div class="siah-field-row siah-field-row--folio">
            <label class="siah-label">FOLIO CONSULTA</label>
            <input v-model="asignar.folioConsulta" class="siah-input siah-input--folio" />
            <span v-if="!asignar.folioConsulta" class="siah-hint">Ingresa No Folio.</span>
          </div>

          <div class="siah-field-row siah-field-row--obs">
            <label class="siah-label siah-label--top">OBSERVACIONES</label>
            <textarea v-model="asignar.observaciones" class="siah-textarea" rows="4" />
          </div>
        </section>

        <!-- Agenda del día (derecha) -->
        <section class="siah-asigna-agenda">
          <p class="siah-agenda-fecha">{{ formatFechaDisplay(asignar.fecha) }}</p>
          <div class="siah-agenda-table-wrap">
            <table class="siah-agenda-table">
              <thead>
                <tr>
                  <th>No</th>
                  <th>FOLIO</th>
                  <th>HORA</th>
                  <th>FICHA</th>
                  <th>NOMBRE</th>
                </tr>
              </thead>
              <tbody>
                <tr v-if="loading && !rows.length">
                  <td colspan="5" class="siah-agenda-empty">Cargando…</td>
                </tr>
                <tr v-else-if="!rows.length">
                  <td colspan="5" class="siah-agenda-empty">Sin citas para esta fecha</td>
                </tr>
                <tr
                  v-for="(row, idx) in rows"
                  v-else
                  :key="String(row.hosi_folio)"
                  :class="citaStatusClass(row.cits_estatus)"
                  class="siah-agenda-row"
                  @click="usarCitaEnAsignar(row)"
                >
                  <td>{{ idx + 1 }}</td>
                  <td>{{ row.hosi_folio }}</td>
                  <td>{{ formatHora(row.citn_hrcita) }}</td>
                  <td>{{ row.derc_ficha }}</td>
                  <td>{{ row.paciente }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div class="siah-agenda-leyenda">
            <span class="siah-leyenda-item siah-leyenda-item--confirmar">POR CONFIRMAR</span>
            <span class="siah-leyenda-item siah-leyenda-item--espera">EN ESPERA</span>
            <span class="siah-leyenda-item siah-leyenda-item--atendido">ATENDIDO</span>
            <span class="siah-leyenda-item siah-leyenda-item--diferido">DIFERIDO</span>
          </div>
        </section>
      </div>
    </div>

        <div v-else-if="tab === 'consulta'" class="flex flex-col gap-3 min-w-0">
          <p class="text-xs font-semibold uppercase text-primary m-0">{{ consultaStatusLine }}</p>

          <div class="flex flex-wrap gap-2">
            <UButton
              label="GRABA CONSULTA"
              color="primary"
              size="sm"
              :loading="loading"
              :disabled="!consulta.hosi_folio || consultaBloqueadaSinSignos"
              @click="doConsulta"
            />
            <UButton
              label="SIGNOS VITALES"
              color="primary"
              :variant="consultaBloqueadaSinSignos ? 'solid' : 'soft'"
              size="sm"
              :disabled="!consulta.hosi_folio"
              @click="openSignosModal"
            />
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
              label="SOLICITUDES"
              color="primary"
              variant="soft"
              size="sm"
              icon="i-lucide-flask-conical"
              :disabled="!consulta.hosi_folio"
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
          </div>

          <UAlert
            v-if="consultaBloqueadaSinSignos"
            color="warning"
            variant="subtle"
            title="Signos vitales requeridos"
            description="Esta especialidad exige registrar signos del folio antes de grabar la nota clínica (odontología y excepciones quedan exentas)."
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
              <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div class="flex flex-col items-center gap-1">
                  <span class="text-xs font-bold text-muted">DIABETES</span>
                  <UBadge
                    :color="notaCronica.diabetes === 'positivo' ? 'error' : 'success'"
                    variant="subtle"
                    size="sm"
                  >
                    {{ notaCronica.diabetes === "positivo" ? "POSITIVO" : "NEGATIVO" }}
                  </UBadge>
                </div>
                <div class="flex flex-col items-center gap-1">
                  <span class="text-xs font-bold text-muted">HIPERTENSIÓN</span>
                  <UBadge
                    :color="notaCronica.hipertension === 'positivo' ? 'error' : 'success'"
                    variant="subtle"
                    size="sm"
                  >
                    {{ notaCronica.hipertension === "positivo" ? "POSITIVO" : "NEGATIVO" }}
                  </UBadge>
                </div>
                <div class="flex flex-col items-center gap-1">
                  <span class="text-xs font-bold text-muted">ALERGIAS</span>
                  <UBadge
                    :color="notaCronica.alergias === 'positivo' ? 'error' : 'success'"
                    variant="subtle"
                    size="sm"
                  >
                    {{ notaCronica.alergias === "positivo" ? "POSITIVO" : "NEGATIVO" }}
                  </UBadge>
                </div>
              </div>
            </AtmedSectionCard>

            <AtmedSectionCard title="Motivo de consulta">
              <div class="grid w-full gap-3 sm:grid-cols-[7rem_minmax(0,1fr)] sm:items-end">
                <UFormField label="CIE-10" class="w-full" :ui="notaFieldUi">
                  <UInput v-model="consulta.motivoCie10" maxlength="5" size="sm" class="w-full uppercase" />
                </UFormField>
                <UFormField label="Motivo de consulta" class="w-full min-w-0" :ui="notaFieldUi">
                  <UInput v-model="consulta.motivoConsulta" size="sm" class="w-full" />
                </UFormField>
              </div>
            </AtmedSectionCard>

            <AtmedSectionCard title="Nota clínica">
              <div class="siah-nota-fields grid w-full gap-4 lg:grid-cols-2">
                <UFormField label="Síntomas o subjetivo" class="w-full min-w-0" :ui="notaFieldUi">
                  <UTextarea
                    v-model="consulta.sintomas"
                    :rows="5"
                    autoresize
                    class="w-full"
                    :ui="notaTextareaUi"
                  />
                </UFormField>
                <UFormField label="Objetivo" class="w-full min-w-0" :ui="notaFieldUi">
                  <UTextarea
                    v-model="consulta.objetivo"
                    :rows="5"
                    autoresize
                    class="w-full"
                    :ui="notaTextareaUi"
                  />
                </UFormField>
                <UFormField label="Análisis" class="w-full min-w-0" :ui="notaFieldUi">
                  <UTextarea
                    v-model="consulta.analisis"
                    :rows="5"
                    autoresize
                    class="w-full"
                    :ui="notaTextareaUi"
                  />
                </UFormField>
                <UFormField label="Plan" class="w-full min-w-0" :ui="notaFieldUi">
                  <UTextarea
                    v-model="consulta.plan"
                    :rows="5"
                    autoresize
                    class="w-full"
                    :ui="notaTextareaUi"
                  />
                </UFormField>
              </div>
            </AtmedSectionCard>

            <AtmedSectionCard title="Diagnóstico de consulta">
              <div class="flex flex-wrap items-end gap-3">
                <UFormField label="CIE-10" class="w-24">
                  <UInput v-model="consulta.diai_clacie1" maxlength="5" placeholder="Ej. R51X" size="sm" class="uppercase" />
                </UFormField>
                <UFormField label="Diagnóstico de consulta" class="min-w-0 flex-1">
                  <UInput v-model="consulta.diagnosticoTexto" size="sm" />
                </UFormField>
                <span class="text-xs font-bold text-muted pb-2">ENFERMEDAD</span>
                <UCheckbox v-model="consulta.enfermedadPrimeraVez" label="1a VEZ" />
                <UCheckbox v-model="consulta.enfermedadSub" label="SUB." />
                <UButton icon="i-lucide-plus" color="primary" variant="soft" size="sm" title="Agregar diagnóstico" />
              </div>
            </AtmedSectionCard>

            <div class="flex justify-end gap-2 pt-1">
              <UButton label="LIMPIAR" color="neutral" variant="outline" size="sm" @click="limpiarConsulta" />
              <UButton
                label="GRABA CONSULTA"
                color="primary"
                size="sm"
                :loading="loading"
                :disabled="consultaBloqueadaSinSignos"
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
