export { default as NotasSubrogadosWidget } from "./NotasSubrogadosWidget.vue";
/** Alias de continuidad con hosts que importaban AtencionMedicaWidget */
export { default as AtencionMedicaWidget } from "./NotasSubrogadosWidget.vue";
export { default as AgendaSection } from "./sections/AgendaSection.vue";
export { default as AsignarCitaSection } from "./sections/AsignarCitaSection.vue";
export { default as ConsultaSection } from "./sections/ConsultaSection.vue";
export { default as SignosSection } from "./sections/SignosSection.vue";
export { default as RecetaSection } from "./sections/RecetaSection.vue";
export {
  createAtmedClient,
  getActiveAtmedClient,
  setActiveAtmedClient,
} from "./client";
export type * from "./types";
