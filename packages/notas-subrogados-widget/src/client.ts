import type { AtmedClientConfig, OkRecord, OkRows, SessionAuth } from "./types";

function joinUrl(base: string, prefix: string, path: string) {
  const b = base.replace(/\/+$/, "");
  const pfx = prefix
    ? prefix.startsWith("/")
      ? prefix.replace(/\/+$/, "")
      : `/${prefix.replace(/\/+$/, "")}`
    : "";
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${b}${pfx}${p}`;
}

export type AtmedClient = {
  config: AtmedClientConfig;
  postJson: <T = unknown>(path: string, body: unknown) => Promise<T>;
  citasDia: (payload: SessionAuth & { fecha?: string }) => Promise<OkRows>;
  citaLlegada: (payload: SessionAuth & { hosi_folio: number }) => Promise<OkRecord>;
  asignarCita: (payload: SessionAuth & Record<string, unknown>) => Promise<OkRecord>;
  grabarConsulta: (payload: SessionAuth & Record<string, unknown>) => Promise<OkRecord>;
  grabarSignos: (payload: SessionAuth & Record<string, unknown>) => Promise<OkRecord>;
  especialidades: (payload: SessionAuth) => Promise<OkRows>;
  medicos: (payload: SessionAuth & { esps_espserv?: number }) => Promise<OkRows>;
  horas: (
    payload: SessionAuth & { medc_ficha: string; medc_codigo?: string; fecha: string },
  ) => Promise<OkRows>;
};

let active: AtmedClient | null = null;

export function setActiveAtmedClient(client: AtmedClient | null) {
  active = client;
}

export function getActiveAtmedClient(): AtmedClient | null {
  return active;
}

export function createAtmedClient(config: AtmedClientConfig): AtmedClient {
  const fetchFn = config.fetchFn || fetch;
  const prefix = config.prefix || "";

  async function postJson<T = unknown>(path: string, body: unknown): Promise<T> {
    const url = joinUrl(config.apiBase, prefix, path);
    const res = await fetchFn(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const detail = (data as { detail?: unknown })?.detail;
      const message = (data as { message?: unknown })?.message;
      throw new Error(
        typeof detail === "string"
          ? detail
          : typeof message === "string"
            ? message
            : "No fue posible completar la operación.",
      );
    }
    return data as T;
  }

  return {
    config,
    postJson,
    citasDia: (payload) => postJson("/sub/atmed/citas", payload),
    citaLlegada: (payload) => postJson("/sub/atmed/llegada", payload),
    asignarCita: (payload) => postJson("/sub/atmed/asignar", payload),
    grabarConsulta: (payload) => postJson("/sub/atmed/consulta", payload),
    grabarSignos: (payload) => postJson("/sub/atmed/signos", payload),
    especialidades: (payload) => postJson("/sub/atmed/especialidades", payload),
    medicos: (payload) => postJson("/sub/atmed/medicos", payload),
    horas: (payload) => postJson("/sub/atmed/horas", payload),
  };
}
