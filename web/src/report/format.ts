import type { SpeedMode } from "./activityTypes";
import type { Grouping, ReportRow } from "./aggregate";

function mmss(totalSeconds: number): string {
  const rounded = Math.round(totalSeconds);
  const m = Math.floor(rounded / 60);
  const s = rounded % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** Pace or speed in the unit the sport is usually read in, as a number for charts. */
export function speedValue(paceSecPerKm: number | null, mode: SpeedMode): number | null {
  if (paceSecPerKm == null || paceSecPerKm <= 0) return null;
  if (mode === "kmh") return 3600 / paceSecPerKm;
  if (mode === "pacePer100m") return paceSecPerKm / 10;
  return paceSecPerKm;
}

export function formatSpeed(paceSecPerKm: number | null, mode: SpeedMode): string {
  const value = speedValue(paceSecPerKm, mode);
  if (value == null) return "—";
  if (mode === "kmh") return `${value.toFixed(1)} км/год`;
  return mode === "pacePer100m" ? `${mmss(value)} /100 м` : `${mmss(value)} /км`;
}

export function speedTitle(mode: SpeedMode): string {
  if (mode === "kmh") return "Середня швидкість";
  return "Середній темп";
}

/** Chart axis tick for the speed series. */
export function formatSpeedTick(value: number, mode: SpeedMode): string {
  return mode === "kmh" ? value.toFixed(0) : mmss(value);
}

export function formatKm(km: number | null): string {
  return km == null ? "—" : km.toFixed(km >= 100 ? 0 : 1);
}

export function formatHr(hr: number | null): string {
  return hr == null ? "—" : String(Math.round(hr));
}

export function formatVo2(value: number | null): string {
  return value == null ? "—" : value.toFixed(1);
}

export function formatDuration(totalSeconds: number): string {
  const minutes = Math.round(totalSeconds / 60);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h} год ${m} хв` : `${m} хв`;
}

function monthEndOf(day: string): string {
  const [y, m] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

function dm(day: string): string {
  return `${day.slice(8, 10)}.${day.slice(5, 7)}`;
}

const MONTHS = [
  "Січень",
  "Лютий",
  "Березень",
  "Квітень",
  "Травень",
  "Червень",
  "Липень",
  "Серпень",
  "Вересень",
  "Жовтень",
  "Листопад",
  "Грудень",
];

export function rowLabel(row: ReportRow, grouping: Grouping): string {
  if (grouping === "month") {
    const month = `${MONTHS[Number(row.start.slice(5, 7)) - 1]} ${row.start.slice(0, 4)}`;
    const whole = row.start.endsWith("-01") && row.end === monthEndOf(row.start);
    return whole ? month : `${month} (${dm(row.start)}–${dm(row.end)})`;
  }
  if (grouping === "week") return `${dm(row.start)} – ${dm(row.end)}.${row.end.slice(0, 4)}`;
  return `${dm(row.start)}.${row.start.slice(0, 4)}`;
}

export function describeCorrelation(r: number | null): string {
  if (r == null) return "замало даних";
  const a = Math.abs(r);
  const strength = a >= 0.7 ? "сильний" : a >= 0.4 ? "помірний" : a >= 0.2 ? "слабкий" : "майже немає";
  if (strength === "майже немає") return "звʼязку майже немає";
  return `${strength} ${r > 0 ? "прямий" : "обернений"} звʼязок`;
}
