export const PRESETS = [
  { id: "3m", label: "3 місяці", months: 3 },
  { id: "6m", label: "6 місяців", months: 6 },
  { id: "12m", label: "12 місяців", months: 12 },
  { id: "ytd", label: "Цей рік", months: null },
  { id: "24m", label: "2 роки", months: 24 },
] as const;

/** Local calendar day of a Date as YYYY-MM-DD. */
export function toDay(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

/** Local midnight of a YYYY-MM-DD day. */
export function fromDay(day: string): Date {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/**
 * [from, to] for a preset. Periods start on the first day of a month, so the
 * oldest month in a monthly report is complete rather than cut in the middle.
 */
export function presetRange(id: string, now: Date): [string, string] {
  const preset = PRESETS.find((p) => p.id === id);
  if (!preset) throw new Error(`Unknown period preset: ${id}`);
  const to = toDay(now);
  if (preset.months === null) return [`${now.getFullYear()}-01-01`, to];
  return [toDay(new Date(now.getFullYear(), now.getMonth() - (preset.months - 1), 1)), to];
}
