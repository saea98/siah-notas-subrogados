export { default as NotasSubrogadosWidget } from "./NotasSubrogadosWidget.vue";
/** Alias de continuidad con hosts que importaban AtencionMedicaWidget */
export { default as AtencionMedicaWidget } from "./NotasSubrogadosWidget.vue";
export {
  createAtmedClient,
  getActiveAtmedClient,
  setActiveAtmedClient,
} from "./client";
export type * from "./types";
