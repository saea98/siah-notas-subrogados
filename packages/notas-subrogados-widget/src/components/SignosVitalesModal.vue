<script setup lang="ts">
type SignosCaptura = {
  pulso: string;
  respiracion: string;
  tension_sis: string;
  tension_dia: string;
  temperatura: string;
  peso: string;
  estatura: string;
  abdominal: string;
};

type SignosRow = {
  pulso?: string | number;
  respiracion?: string | number;
  tension_sis?: string | number;
  tension_dia?: string | number;
  temperatura?: string | number;
  peso?: string | number;
  estatura?: string | number;
  abdominal?: string | number;
};

const open = defineModel<boolean>("open", { required: true });

defineProps<{
  loading: boolean;
  pacienteLine: string;
  signos: SignosCaptura;
  ultimosSignos: SignosRow | null;
  signosImc: number | null;
  signosClasificacion: string;
  ultimosImc: number | null;
  ultimosClasificacion: string;
  ultimosFechaLabel: string;
}>();

const emit = defineEmits<{
  graba: [];
  copiar: [];
  close: [];
}>();
</script>

<template>
  <UModal v-model:open="open" :ui="{ content: 'max-w-4xl w-full' }">
    <template #content>
      <div class="flex flex-col max-h-[min(92vh,720px)]">
        <div
          class="flex flex-wrap items-center justify-between gap-2 border-b border-default bg-elevated px-4 py-3"
        >
          <UButton
            label="GRABA SIGNOS"
            color="primary"
            size="sm"
            :loading="loading"
            @click="emit('graba')"
          />
          <h2 id="siah-signos-title" class="text-sm font-bold uppercase tracking-wide text-highlighted">
            Registro de signos vitales
          </h2>
          <UButton label="Plan Nutricional" color="success" variant="soft" size="sm" disabled />
        </div>

        <p class="border-b border-default px-4 py-2 text-xs font-semibold uppercase text-primary">
          {{ pacienteLine }}
        </p>

        <div class="grid gap-3 p-3 md:grid-cols-2 overflow-y-auto">
          <UCard
            :ui="{
              root: 'min-h-56',
              header: 'px-3 py-2 bg-inverted',
              body: 'p-3 space-y-2',
            }"
          >
            <template #header>
              <span class="text-xs font-bold uppercase tracking-wide text-inverted">Registro de signos vitales</span>
            </template>

            <div class="grid gap-2">
              <UFormField label="Pulso">
                <UInput v-model="signos.pulso" inputmode="numeric" size="sm" />
              </UFormField>
              <UFormField label="Resp x min">
                <UInput v-model="signos.respiracion" inputmode="numeric" size="sm" />
              </UFormField>
              <UFormField label="Tensión arterial">
                <div class="flex items-center gap-2">
                  <UInput v-model="signos.tension_sis" inputmode="numeric" size="sm" class="flex-1" />
                  <span class="text-muted">/</span>
                  <UInput v-model="signos.tension_dia" inputmode="numeric" size="sm" class="flex-1" />
                </div>
              </UFormField>
              <UFormField label="Temp (°C)">
                <UInput v-model="signos.temperatura" inputmode="decimal" size="sm" />
              </UFormField>
              <UFormField label="Peso (kg)">
                <UInput v-model="signos.peso" inputmode="decimal" size="sm" />
              </UFormField>
              <UFormField label="Estatura (m)">
                <UInput v-model="signos.estatura" inputmode="decimal" size="sm" />
              </UFormField>
              <UFormField label="I.M.C">
                <UInput :model-value="signosImc ?? '—'" readonly size="sm" />
              </UFormField>
              <UFormField label="Clasificación">
                <UInput
                  :model-value="signosClasificacion || '—'"
                  readonly
                  size="sm"
                  :ui="{ base: signosClasificacion === 'SOBREPESO' ? 'bg-warning-100 dark:bg-warning-950/30' : '' }"
                />
              </UFormField>
              <UFormField label="Percentil">
                <UInput model-value="N/A" readonly size="sm" />
              </UFormField>
              <UFormField label="P. abdominal (cm)">
                <UInput v-model="signos.abdominal" inputmode="numeric" size="sm" />
              </UFormField>
            </div>
          </UCard>

          <UCard
            :ui="{
              root: 'min-h-56',
              header: 'px-3 py-2 bg-inverted',
              body: 'p-3 space-y-2',
            }"
          >
            <template #header>
              <div class="flex w-full flex-wrap items-center justify-between gap-2">
                <span class="text-xs font-bold uppercase tracking-wide text-inverted">
                  Últimos signos vitales registrados
                </span>
                <span v-if="ultimosFechaLabel" class="text-[0.65rem] font-semibold text-warning-300">
                  {{ ultimosFechaLabel }}
                </span>
              </div>
            </template>

            <p v-if="!ultimosSignos" class="text-sm italic text-muted">Sin tomas previas para este paciente.</p>
            <div v-else class="grid gap-2">
              <UFormField label="Pulso">
                <UInput :model-value="ultimosSignos.pulso ?? '—'" readonly size="sm" />
              </UFormField>
              <UFormField label="Resp x min">
                <UInput :model-value="ultimosSignos.respiracion ?? '—'" readonly size="sm" />
              </UFormField>
              <UFormField label="Tensión arterial">
                <UInput
                  :model-value="`${ultimosSignos.tension_sis ?? '—'} / ${ultimosSignos.tension_dia ?? '—'}`"
                  readonly
                  size="sm"
                />
              </UFormField>
              <UFormField label="Temp (°C)">
                <UInput :model-value="ultimosSignos.temperatura ?? '—'" readonly size="sm" />
              </UFormField>
              <UFormField label="Peso (kg)">
                <UInput :model-value="ultimosSignos.peso ?? '—'" readonly size="sm" />
              </UFormField>
              <UFormField label="Estatura (m)">
                <UInput :model-value="ultimosSignos.estatura ?? '—'" readonly size="sm" />
              </UFormField>
              <UFormField label="I.M.C">
                <UInput :model-value="ultimosImc ?? '—'" readonly size="sm" />
              </UFormField>
              <UFormField label="Clasificación">
                <UInput
                  :model-value="ultimosClasificacion || '—'"
                  readonly
                  size="sm"
                  :ui="{ base: ultimosClasificacion === 'SOBREPESO' ? 'bg-warning-100 dark:bg-warning-950/30' : '' }"
                />
              </UFormField>
              <UFormField label="Percentil">
                <UInput model-value="N/A" readonly size="sm" />
              </UFormField>
              <UFormField label="P. abdominal (cm)">
                <UInput :model-value="ultimosSignos.abdominal ?? '—'" readonly size="sm" />
              </UFormField>
              <UButton
                v-if="ultimosSignos"
                label="Copiar última toma a captura"
                variant="soft"
                color="primary"
                size="xs"
                block
                @click="emit('copiar')"
              />
            </div>
          </UCard>
        </div>

        <div class="flex justify-center border-t border-default px-4 py-3">
          <UButton label="Salir" variant="outline" color="neutral" @click="emit('close')" />
        </div>
      </div>
    </template>
  </UModal>
</template>
