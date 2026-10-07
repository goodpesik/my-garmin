export interface Activity {
  activity_id: number;
  name: string | null;
  type_key: string;
  /** Local start time as Garmin reports it: "YYYY-MM-DD HH:MM:SS". */
  start_local: string;
  distance_m: number | null;
  duration_s: number | null;
  moving_s: number | null;
  avg_hr: number | null;
  max_hr: number | null;
  elevation_gain_m: number | null;
  /** Garmin's VO2max estimate recorded with the workout, if any. */
  vo2max: number | null;
  /** 1 — an interval workout (work intervals, a structured workout or Garmin's flag). */
  is_interval?: number | null;
}

/** Running split by how it was run: steady (cross) or intervals. */
export type RunCategory = "all" | "cross" | "intervals";

export function byRunCategory(activities: Activity[], category: RunCategory): Activity[] {
  if (category === "intervals") return activities.filter((a) => a.is_interval === 1);
  if (category === "cross") return activities.filter((a) => a.is_interval !== 1);
  return activities;
}

export type Grouping = "workout" | "week" | "month";

export interface ReportRow {
  key: string;
  /** First day of the bucket (or the workout date), YYYY-MM-DD. */
  start: string;
  /** Last day of the bucket, YYYY-MM-DD; equals start for a workout. */
  end: string;
  name: string | null;
  count: number;
  totalKm: number;
  /** Mean distance of one workout in the bucket. */
  avgKm: number | null;
  /** Total time over total distance, seconds per km. */
  paceSecPerKm: number | null;
  /** Mean of the workouts' average heart rate. */
  avgHr: number | null;
  /** Mean VO2max over the workouts that carry one. */
  avgVo2max: number | null;
  totalDurationS: number;
}

const DAY_MS = 86_400_000;

function toUtc(day: string): number {
  const [y, m, d] = day.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

function fromUtc(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function addDays(day: string, days: number): string {
  return fromUtc(toUtc(day) + days * DAY_MS);
}

/** Monday of the ISO week that contains the day. */
export function weekStart(day: string): string {
  const weekday = (new Date(toUtc(day)).getUTCDay() + 6) % 7; // Monday = 0
  return addDays(day, -weekday);
}

export function monthStart(day: string): string {
  return `${day.slice(0, 7)}-01`;
}

function monthEnd(day: string): string {
  const [y, m] = day.split("-").map(Number);
  return fromUtc(Date.UTC(y, m, 0));
}

function nextMonth(day: string): string {
  const [y, m] = day.split("-").map(Number);
  return fromUtc(Date.UTC(y, m, 1));
}

function summarize(activities: Activity[]): Omit<ReportRow, "key" | "start" | "end" | "name"> {
  let totalM = 0;
  let pacedM = 0;
  let pacedS = 0;
  let totalDurationS = 0;
  let hrSum = 0;
  let hrCount = 0;
  let vo2Sum = 0;
  let vo2Count = 0;
  for (const a of activities) {
    const distance = a.distance_m ?? 0;
    const duration = a.duration_s ?? 0;
    totalM += distance;
    totalDurationS += duration;
    if (distance > 0 && duration > 0) {
      pacedM += distance;
      pacedS += duration;
    }
    if (a.avg_hr != null && a.avg_hr > 0) {
      hrSum += a.avg_hr;
      hrCount += 1;
    }
    if (a.vo2max != null && a.vo2max > 0) {
      vo2Sum += a.vo2max;
      vo2Count += 1;
    }
  }
  const count = activities.length;
  return {
    count,
    totalKm: totalM / 1000,
    avgKm: count > 0 ? totalM / 1000 / count : null,
    paceSecPerKm: pacedM > 0 ? pacedS / (pacedM / 1000) : null,
    avgHr: hrCount > 0 ? hrSum / hrCount : null,
    avgVo2max: vo2Count > 0 ? vo2Sum / vo2Count : null,
    totalDurationS,
  };
}

/** Activities whose type is selected and whose local date lies in [from, to]. */
export function selectActivities(activities: Activity[], typeKeys: readonly string[], from: string, to: string): Activity[] {
  const keys = new Set(typeKeys);
  return activities
    .filter((a) => keys.has(a.type_key))
    .filter((a) => {
      const day = a.start_local.slice(0, 10);
      return day >= from && day <= to;
    })
    .sort((a, b) => a.start_local.localeCompare(b.start_local));
}

/**
 * Rows of the report, oldest first. Weeks and months cover the whole period,
 * including those without workouts, so the chart shows gaps as gaps.
 */
export function buildReport(activities: Activity[], grouping: Grouping, from: string, to: string): ReportRow[] {
  if (grouping === "workout") {
    return activities.map((a) => {
      const day = a.start_local.slice(0, 10);
      return { key: String(a.activity_id), start: day, end: day, name: a.name, ...summarize([a]) };
    });
  }

  const startOf = grouping === "week" ? weekStart : monthStart;
  const buckets = new Map<string, Activity[]>();
  for (const a of activities) {
    const key = startOf(a.start_local.slice(0, 10));
    const bucket = buckets.get(key);
    if (bucket) bucket.push(a);
    else buckets.set(key, [a]);
  }

  const rows: ReportRow[] = [];
  for (let start = startOf(from); start <= to; start = grouping === "week" ? addDays(start, 7) : nextMonth(start)) {
    const end = grouping === "week" ? addDays(start, 6) : monthEnd(start);
    // The first and last buckets may be cut by the period; show the days actually counted.
    rows.push({
      key: start,
      start: start < from ? from : start,
      end: end > to ? to : end,
      name: null,
      ...summarize(buckets.get(start) ?? []),
    });
  }
  return rows;
}

export function totals(activities: Activity[]): Omit<ReportRow, "key" | "start" | "end" | "name"> {
  return summarize(activities);
}

/** Pearson correlation over pairs where both values exist; null below three pairs or with no spread. */
export function pearson(pairs: [number | null, number | null][]): number | null {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const [x, y] of pairs) {
    if (x == null || y == null) continue;
    xs.push(x);
    ys.push(y);
  }
  const n = xs.length;
  if (n < 3) return null;
  const mx = xs.reduce((s, v) => s + v, 0) / n;
  const my = ys.reduce((s, v) => s + v, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2;
    syy += (ys[i] - my) ** 2;
  }
  if (sxx === 0 || syy === 0) return null;
  return sxy / Math.sqrt(sxx * syy);
}

export interface Correlations {
  speedHr: number | null;
  kmHr: number | null;
  kmSpeed: number | null;
  pairs: number;
}

/**
 * Correlations across the report rows that have workouts. `speedOf` turns pace
 * into the unit the sport is read in (pace or km/h), so the sign means what the
 * person sees in the table.
 */
export function correlations(rows: ReportRow[], speedOf: (paceSecPerKm: number | null) => number | null): Correlations {
  const active = rows.filter((r) => r.count > 0);
  // For buckets the distance that matters is the volume; for single workouts it is the workout length.
  return {
    speedHr: pearson(active.map((r) => [speedOf(r.paceSecPerKm), r.avgHr])),
    kmHr: pearson(active.map((r) => [r.totalKm, r.avgHr])),
    kmSpeed: pearson(active.map((r) => [r.totalKm, speedOf(r.paceSecPerKm)])),
    pairs: active.length,
  };
}
