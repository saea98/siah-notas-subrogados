export type SessionAuth = {
  usuario: string;
  password?: string;
  /** Access token de Keycloak. Lo inyecta el proxy del host; no enviar desde el navegador. */
  bearer?: string | null;
  unitrab: string | number;
  rol?: string;
  tipo_usuario?: string | null;
  /** Schema Postgres. Lo inyecta el proxy del host. */
  pg_schema?: string | null;
};

export type AtmedClientConfig = {
  apiBase: string;
  prefix?: string;
  fetchFn?: typeof fetch;
};

export type CitaRow = Record<string, unknown> & {
  hosi_folio?: number;
  derc_ficha?: string;
  derc_codigo?: string;
  paciente?: string;
  especialidad?: string;
  medico?: string;
  citn_hrcita?: number;
  cits_estatus?: number;
  cits_hrllegada?: number;
};

export type OkRows = {
  ok: boolean;
  mensaje?: string;
  rows: Record<string, unknown>[];
  total?: number;
};

export type OkRecord = {
  ok: boolean;
  mensaje?: string;
  record?: Record<string, unknown>;
};
