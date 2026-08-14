export type SessionAuth = {
  usuario: string;
  password: string;
  unitrab: string | number;
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
