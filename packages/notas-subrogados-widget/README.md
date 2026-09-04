# @siah/notas-subrogados-widget

Widget Vue 3 + Nuxt UI para **Atención médica Subrogados**: agenda del día, asignar cita, nota SOAP (consulta) y signos vitales.

Habla con el FastAPI de `siah-subrogados` (`POST /sub/atmed/*`).

```text
des_python/
  siah-subrogados/                 ← API + host HIS
  siah-notas-subrogados/           ← este repo
    packages/notas-subrogados-widget/
  siah-notas-subrogados-laravel-demo/
```

## Uso

```vue
<script setup lang="ts">
import { NotasSubrogadosWidget } from "@siah/notas-subrogados-widget";
// o alias: import { AtencionMedicaWidget } from "@siah/notas-subrogados-widget";
</script>

<template>
  <NotasSubrogadosWidget
    :api-base="apiBase"
    :api-prefix="apiPrefix"
    :session="{ usuario, password, unitrab }"
    @open-expediente="onOpenExpediente"
  />
</template>
```

### Props

| Prop | Tipo | Descripción |
|------|------|-------------|
| `apiBase` | `string` | Base del FastAPI (ej. `http://127.0.0.1:8002`) |
| `apiPrefix` | `string` | Prefijo opcional (proxy Laravel) |
| `session` | `{ usuario, password, unitrab }` | Credenciales APT |

### Eventos

| Evento | Payload |
|--------|---------|
| `openExpediente` | `{ ficha, codigo, hosi_folio? }` |
| `openReceta` | `{ ficha, codigo, empresa, hosi_folio?, paciente?, diagnostico? }` |

### Endpoints

- `POST /sub/atmed/citas` · `llegada` · `asignar`
- `POST /sub/atmed/consulta` · `signos` · `signos/ultimos`
- `POST /sub/atmed/especialidades` · `medicos` · `horas`

## Peer deps

- `vue` ^3.5
- `@nuxt/ui` ^4

El host debe escanear el package en Tailwind (`@source .../notas-subrogados-widget/src/**/*`).
