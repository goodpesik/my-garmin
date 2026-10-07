<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import Button from "primevue/button";
import Chart from "primevue/chart";
import Column from "primevue/column";
import DataTable from "primevue/datatable";
import DatePicker from "primevue/datepicker";
import Message from "primevue/message";
import Select from "primevue/select";
import SelectButton from "primevue/selectbutton";
import { api, ApiError, type Me } from "../api";
import { buildFilters } from "../report/activityTypes";
import { buildReport, correlations, selectActivities, totals, type Activity, type Grouping } from "../report/aggregate";
import { buildChart } from "../report/chart";
import { describeCorrelation, formatDuration, formatHr, formatKm, formatSpeed, rowLabel, speedTitle, speedValue } from "../report/format";
import { PRESETS, presetRange, toDay, fromDay } from "../report/period";
import { isDark } from "../theme";

const props = defineProps<{ me: Me }>();
const emit = defineEmits<{ refreshMe: [] }>();

const preset = ref<string | null>("6m");
const range = ref<(Date | null)[]>(presetRange("6m", new Date()).map(fromDay));
const grouping = ref<Grouping>("month");
const filterId = ref<string | null>(null);

const activities = ref<Activity[]>([]);
const loading = ref(false);
const error = ref("");

const today = new Date();

const groupingOptions = [
  { label: "Тренування", value: "workout" },
  { label: "Тижні", value: "week" },
  { label: "Місяці", value: "month" },
];

const period = computed(() => {
  const [start, end] = range.value;
  // While only the first day is picked, keep showing the previous report.
  if (!start || !end) return null;
  return { from: toDay(start), to: toDay(end) };
});

function applyPreset(id: string) {
  preset.value = id;
  range.value = presetRange(id, new Date()).map(fromDay);
}

function onRangePicked() {
  preset.value = null;
}

const shown = ref<{ from: string; to: string } | null>(null);
let requestSeq = 0;

async function load() {
  if (!period.value) return;
  const { from, to } = period.value;
  const seq = ++requestSeq;
  loading.value = true;
  error.value = "";
  try {
    const response = await api.activities(from, to);
    // Only the newest request may change what is shown.
    if (seq !== requestSeq) return;
    activities.value = response.activities;
    shown.value = { from, to };
  } catch (e) {
    if (seq !== requestSeq) return;
    error.value = e instanceof ApiError ? e.message : "Не вдалося завантажити тренування.";
  } finally {
    if (seq === requestSeq) loading.value = false;
  }
}

watch(period, load, { immediate: true });

const filters = computed(() => {
  const counts = new Map<string, number>();
  for (const a of activities.value) counts.set(a.type_key, (counts.get(a.type_key) ?? 0) + 1);
  return buildFilters(counts);
});

watch(filters, (list) => {
  if (!list.some((f) => f.id === filterId.value)) filterId.value = list[0]?.id ?? null;
});

const filter = computed(() => filters.value.find((f) => f.id === filterId.value) ?? null);
const mode = computed(() => filter.value?.speedMode ?? "pacePerKm");

const selected = computed(() =>
  filter.value && shown.value ? selectActivities(activities.value, filter.value.typeKeys, shown.value.from, shown.value.to) : [],
);
const rows = computed(() => (shown.value ? buildReport(selected.value, grouping.value, shown.value.from, shown.value.to) : []));
const summary = computed(() => totals(selected.value));
const speedShort = computed(() => (mode.value === "kmh" ? "Швидкість" : "Темп"));
const corr = computed(() => correlations(rows.value, (pace) => speedValue(pace, mode.value)));

function cssVar(name: string, fallback: string) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

const chart = computed(() => {
  // Colors come from theme variables, so rebuild when the theme flips.
  void isDark.value;
  return buildChart(rows.value, grouping.value, mode.value, {
    km: cssVar("--p-primary-300", "#86efac"),
    speed: cssVar("--p-blue-500", "#3b82f6"),
    hr: cssVar("--p-red-500", "#ef4444"),
    text: cssVar("--p-text-muted-color", "#64748b"),
    grid: cssVar("--p-content-border-color", "#e2e8f0"),
  });
});

// ---- sync ---------------------------------------------------------------

let poll: ReturnType<typeof setInterval> | undefined;

watch(
  () => props.me.syncing,
  (syncing) => {
    if (syncing && !poll) poll = setInterval(() => emit("refreshMe"), 3000);
    if (!syncing && poll) {
      clearInterval(poll);
      poll = undefined;
    }
  },
  { immediate: true },
);

// A finished sync changes lastSyncAt; this also catches a sync too quick to be seen running.
watch(
  () => props.me.lastSyncAt,
  (now, before) => {
    if (now !== before) load();
  },
);

onBeforeUnmount(() => poll && clearInterval(poll));

const syncError = ref("");

async function syncNow() {
  syncError.value = "";
  try {
    await api.sync();
    emit("refreshMe");
  } catch (e) {
    syncError.value = e instanceof ApiError ? e.message : "Не вдалося запустити оновлення.";
  }
}

const lastSync = computed(() => {
  if (!props.me.lastSyncAt) return "ще не оновлювалось";
  return new Date(props.me.lastSyncAt).toLocaleString("uk-UA", { dateStyle: "medium", timeStyle: "short" });
});

function corrClass(r: number | null) {
  if (r == null) return "muted";
  return Math.abs(r) >= 0.4 ? "strong" : "";
}
</script>

<template>
  <section class="toolbar card">
    <div class="sync">
      <span class="muted">
        Тренувань у базі: <b>{{ me.activityCount }}</b> · оновлено: {{ lastSync }}
      </span>
      <Button
        :label="me.syncing ? 'Оновлюю…' : 'Оновити з Garmin'"
        icon="pi pi-refresh"
        size="small"
        severity="secondary"
        outlined
        :loading="me.syncing"
        @click="syncNow"
      />
    </div>
    <Message v-if="me.lastSyncError" severity="warn" size="small">{{ me.lastSyncError }}</Message>
    <Message v-if="syncError" severity="error" size="small">{{ syncError }}</Message>

    <div class="filters">
      <div class="field">
        <span class="label">Період</span>
        <div class="presets">
          <Button
            v-for="p in PRESETS"
            :key="p.id"
            :label="p.label"
            size="small"
            :severity="preset === p.id ? undefined : 'secondary'"
            :outlined="preset !== p.id"
            @click="applyPreset(p.id)"
          />
        </div>
        <DatePicker
          v-model="range"
          selection-mode="range"
          date-format="dd.mm.yy"
          show-icon
          :manual-input="false"
          :max-date="today"
          class="range"
          @update:model-value="onRangePicked"
        />
      </div>

      <div class="field">
        <span class="label">Активність</span>
        <Select
          v-model="filterId"
          :options="filters"
          option-label="label"
          option-value="id"
          placeholder="Немає тренувань"
          :disabled="filters.length === 0"
          class="activity"
        />
      </div>

      <div class="field">
        <span class="label">Показати по</span>
        <SelectButton v-model="grouping" :options="groupingOptions" option-label="label" option-value="value" :allow-empty="false" />
      </div>
    </div>
  </section>

  <Message v-if="error" severity="error" class="block">{{ error }}</Message>

  <Message v-if="me.syncing && me.activityCount === 0" severity="info" class="block">
    Завантажую історію з Garmin. Перший раз це може тривати кілька хвилин.
  </Message>

  <template v-if="filter">
    <section class="stats">
      <div class="stat card">
        <span class="label">Тренувань</span>
        <b>{{ summary.count }}</b>
      </div>
      <div class="stat card">
        <span class="label">Усього км</span>
        <b>{{ formatKm(summary.totalKm) }}</b>
      </div>
      <div class="stat card">
        <span class="label">Середня дистанція</span>
        <b>{{ formatKm(summary.avgKm) }} км</b>
      </div>
      <div class="stat card">
        <span class="label">{{ speedTitle(mode) }}</span>
        <b>{{ formatSpeed(summary.paceSecPerKm, mode) }}</b>
      </div>
      <div class="stat card">
        <span class="label">Середній пульс</span>
        <b>{{ formatHr(summary.avgHr) }}</b>
      </div>
      <div class="stat card">
        <span class="label">Час</span>
        <b>{{ formatDuration(summary.totalDurationS) }}</b>
      </div>
    </section>

    <section class="card chart-card">
      <Chart type="bar" :data="chart.data" :options="chart.options" class="chart" />
    </section>

    <section class="card corr">
      <h3>Кореляції</h3>
      <p class="muted small">
        По {{ corr.pairs }} {{ grouping === "workout" ? "тренуваннях" : grouping === "week" ? "тижнях" : "місяцях" }} з
        даними.
        <template v-if="mode !== 'kmh'">Темп — час на дистанцію: більше значення означає повільніше.</template>
      </p>
      <div class="corr-grid">
        <div>
          <span class="label">{{ speedShort }} ↔ пульс</span>
          <b :class="corrClass(corr.speedHr)">{{ corr.speedHr == null ? "—" : corr.speedHr.toFixed(2) }}</b>
          <span class="muted small">{{ describeCorrelation(corr.speedHr) }}</span>
        </div>
        <div>
          <span class="label">Км ↔ пульс</span>
          <b :class="corrClass(corr.kmHr)">{{ corr.kmHr == null ? "—" : corr.kmHr.toFixed(2) }}</b>
          <span class="muted small">{{ describeCorrelation(corr.kmHr) }}</span>
        </div>
        <div>
          <span class="label">Км ↔ {{ speedShort.toLowerCase() }}</span>
          <b :class="corrClass(corr.kmSpeed)">{{ corr.kmSpeed == null ? "—" : corr.kmSpeed.toFixed(2) }}</b>
          <span class="muted small">{{ describeCorrelation(corr.kmSpeed) }}</span>
        </div>
      </div>
    </section>

    <section class="card">
      <DataTable :value="[...rows].reverse()" data-key="key" size="small" striped-rows :loading="loading" scrollable>
        <Column :header="grouping === 'workout' ? 'Дата' : grouping === 'week' ? 'Тиждень' : 'Місяць'">
          <template #body="{ data }">
            {{ rowLabel(data, grouping) }}
            <div v-if="grouping === 'workout' && data.name" class="muted small">{{ data.name }}</div>
          </template>
        </Column>
        <Column v-if="grouping !== 'workout'" header="Тренувань" field="count" />
        <Column :header="grouping === 'workout' ? 'Км' : 'Усього км'">
          <template #body="{ data }">{{ data.count ? formatKm(data.totalKm) : "—" }}</template>
        </Column>
        <Column v-if="grouping !== 'workout'" header="Середня дистанція, км">
          <template #body="{ data }">{{ formatKm(data.avgKm) }}</template>
        </Column>
        <Column :header="speedTitle(mode)">
          <template #body="{ data }">{{ formatSpeed(data.paceSecPerKm, mode) }}</template>
        </Column>
        <Column header="Середній пульс">
          <template #body="{ data }">{{ formatHr(data.avgHr) }}</template>
        </Column>
        <Column header="Час">
          <template #body="{ data }">{{ data.count ? formatDuration(data.totalDurationS) : "—" }}</template>
        </Column>
      </DataTable>
    </section>
  </template>

  <section v-else-if="!loading" class="card empty muted">За цей період тренувань немає.</section>
</template>

<style scoped>
.card {
  background: var(--p-content-background);
  border: 1px solid var(--p-content-border-color);
  border-radius: 12px;
  padding: 16px;
  margin-bottom: 16px;
}
.toolbar {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.sync {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}
.filters {
  display: flex;
  gap: 24px;
  flex-wrap: wrap;
  align-items: flex-start;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.presets {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
.range {
  max-width: 280px;
}
.activity {
  min-width: 200px;
}
.label {
  font-size: 0.8rem;
  color: var(--p-text-muted-color);
}
.muted {
  color: var(--p-text-muted-color);
}
.small {
  font-size: 0.8rem;
}
.block {
  margin-bottom: 16px;
}
.stats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 12px;
  margin-bottom: 16px;
}
.stat {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 0;
}
.stat b {
  font-size: 1.35rem;
}
.chart-card {
  height: 380px;
}
.chart {
  height: 100%;
}
.corr h3 {
  margin: 0 0 4px;
  font-size: 1rem;
}
.corr-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 12px;
  margin-top: 12px;
}
.corr-grid > div {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.corr-grid b {
  font-size: 1.25rem;
}
.corr-grid b.strong {
  color: var(--p-primary-color);
}
.empty {
  text-align: center;
  padding: 48px 16px;
}
</style>
