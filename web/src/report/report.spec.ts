import { describe, expect, it } from "vitest";
import { buildFilters } from "./activityTypes";
import { buildReport, byRunCategory, correlations, pearson, selectActivities, weekStart, type Activity } from "./aggregate";
import { formatSpeed, rowLabel } from "./format";
import { presetRange } from "./period";
import { distanceSeries } from "./chart";

function run(id: number, start: string, km: number | null, minutes: number | null, hr: number | null, type = "running"): Activity {
  return {
    activity_id: id,
    name: `Run ${id}`,
    type_key: type,
    start_local: start,
    distance_m: km == null ? null : km * 1000,
    duration_s: minutes == null ? null : minutes * 60,
    moving_s: null,
    avg_hr: hr,
    max_hr: null,
    elevation_gain_m: null,
    vo2max: null,
  };
}

describe("selectActivities", () => {
  const all = [
    run(1, "2026-02-28 23:59:00", 5, 25, 150),
    run(2, "2026-03-01 00:01:00", 5, 25, 150),
    run(3, "2026-03-15 07:00:00", 20, 80, 140, "road_biking"),
    run(4, "2026-03-31 23:59:00", 5, 25, 150, "trail_running"),
    run(5, "2026-04-01 00:00:00", 5, 25, 150),
  ];

  it("keeps only the selected types inside the inclusive local-date period", () => {
    const ids = selectActivities(all, ["running", "trail_running"], "2026-03-01", "2026-03-31").map((a) => a.activity_id);
    expect(ids).toEqual([2, 4]);
  });
});

describe("buildReport by month", () => {
  const acts = [
    run(1, "2026-01-05 07:00:00", 10, 50, 150),
    run(2, "2026-01-20 07:00:00", 5, 30, 160),
    run(3, "2026-03-02 07:00:00", 8, 40, null),
  ];
  const rows = buildReport(acts, "month", "2026-01-01", "2026-03-31");

  it("covers every month of the period, including empty ones", () => {
    expect(rows.map((r) => r.start)).toEqual(["2026-01-01", "2026-02-01", "2026-03-01"]);
    expect(rows[1]).toMatchObject({ count: 0, totalKm: 0, avgKm: null, paceSecPerKm: null, avgHr: null });
  });

  it("sums distance, averages it per workout, and averages workout heart rates", () => {
    expect(rows[0].count).toBe(2);
    expect(rows[0].totalKm).toBe(15);
    expect(rows[0].avgKm).toBe(7.5);
    expect(rows[0].avgHr).toBe(155);
  });

  it("takes pace as total time over total distance", () => {
    // 80 min over 15 km, not the mean of 5:00 and 6:00.
    expect(rows[0].paceSecPerKm).toBeCloseTo((80 * 60) / 15);
    expect(rows[2].avgHr).toBeNull();
  });

  it("ends the last month on its real last day", () => {
    expect(buildReport(acts, "month", "2024-02-01", "2024-03-10")[0].end).toBe("2024-02-29");
  });
});

describe("buildReport by week", () => {
  it("buckets by ISO week starting on Monday across a year boundary", () => {
    expect(weekStart("2026-01-01")).toBe("2025-12-29");
    expect(weekStart("2025-12-29")).toBe("2025-12-29");
    expect(weekStart("2026-01-04")).toBe("2025-12-29");
    const acts = [run(1, "2025-12-29 07:00:00", 5, 25, 150), run(2, "2026-01-04 21:00:00", 10, 55, 150), run(3, "2026-01-05 07:00:00", 3, 15, 150)];
    const rows = buildReport(selectActivities(acts, ["running"], "2025-12-30", "2026-01-11"), "week", "2025-12-30", "2026-01-11");
    expect(rows.map((r) => [r.start, r.end, r.count])).toEqual([
      ["2025-12-30", "2026-01-04", 1],
      ["2026-01-05", "2026-01-11", 1],
    ]);
  });
});

describe("buildReport by workout", () => {
  it("gives one row per workout and ignores missing duration for pace", () => {
    const rows = buildReport([run(1, "2026-01-05 07:00:00", 10, null, 150), run(2, "2026-01-06 07:00:00", 10, 50, 150)], "workout", "2026-01-01", "2026-01-31");
    expect(rows.map((r) => r.key)).toEqual(["1", "2"]);
    expect(rows[0].paceSecPerKm).toBeNull();
    expect(rows[1].paceSecPerKm).toBe(300);
  });
});

describe("correlations", () => {
  it("computes Pearson on rows with workouts only", () => {
    expect(pearson([[1, 2], [2, 4], [3, 6]])).toBeCloseTo(1);
    expect(pearson([[1, 6], [2, 4], [3, 2]])).toBeCloseTo(-1);
    expect(pearson([[1, 2], [2, null], [3, 6]])).toBeNull();
    expect(pearson([[1, 5], [2, 5], [3, 5]])).toBeNull();

    const rows = buildReport(
      [run(1, "2026-01-05 07:00:00", 5, 25, 140), run(2, "2026-03-05 07:00:00", 10, 55, 150), run(3, "2026-05-05 07:00:00", 15, 90, 160)],
      "month",
      "2026-01-01",
      "2026-05-31",
    );
    const c = correlations(rows, (pace) => pace);
    expect(c.pairs).toBe(3);
    expect(c.kmHr).toBeCloseTo(1);
    // Slower pace on longer runs: positive with pace, negative once read as speed.
    expect(c.kmSpeed).toBeGreaterThan(0.9);
    expect(correlations(rows, (pace) => (pace == null ? null : 3600 / pace)).kmSpeed).toBeLessThan(-0.9);
  });
});

describe("buildFilters", () => {
  it("groups known running types and keeps unknown types separate", () => {
    const filters = buildFilters(new Map([["running", 3], ["trail_running", 2], ["yoga", 4], ["road_biking", 1]]));
    expect(filters.map((f) => [f.id, f.label])).toEqual([
      ["running", "Біг"],
      ["type:yoga", "Yoga"],
      ["cycling", "Велосипед"],
    ]);
    expect(filters[0].typeKeys).toContain("trail_running");
    expect(filters[1].typeKeys).toEqual(["yoga"]);
  });
});

describe("format", () => {
  it("shows pace per km, per 100 m and speed", () => {
    expect(formatSpeed(305, "pacePerKm")).toBe("5:05 /км");
    expect(formatSpeed(1200, "pacePer100m")).toBe("2:00 /100 м");
    expect(formatSpeed(120, "kmh")).toBe("30.0 км/год");
    expect(formatSpeed(null, "pacePerKm")).toBe("—");
  });

  it("labels months and weeks", () => {
    const [month] = buildReport([], "month", "2026-10-01", "2026-10-31");
    expect(rowLabel(month, "month")).toBe("Жовтень 2026");
    const [week] = buildReport([], "week", "2026-10-05", "2026-10-11");
    expect(rowLabel(week, "week")).toBe("05.10 – 11.10.2026");
  });
});

describe("presetRange", () => {
  it("starts on the first day of the oldest whole month and ends today", () => {
    const now = new Date(2026, 9, 7, 15, 0);
    expect(presetRange("6m", now)).toEqual(["2026-05-01", "2026-10-07"]);
    expect(presetRange("12m", now)).toEqual(["2025-11-01", "2026-10-07"]);
    expect(presetRange("ytd", now)).toEqual(["2026-01-01", "2026-10-07"]);
  });
});

describe("period edges", () => {
  it("shows the cut first week and month as the days actually counted", () => {
    const weeks = buildReport([run(1, "2026-10-01 07:00:00", 5, 25, 150)], "week", "2026-10-01", "2026-10-07");
    expect(weeks.map((r) => [r.start, r.end])).toEqual([
      ["2026-10-01", "2026-10-04"],
      ["2026-10-05", "2026-10-07"],
    ]);
    const months = buildReport([], "month", "2026-09-15", "2026-10-31");
    expect(months.map((r) => rowLabel(r, "month"))).toEqual(["Вересень 2026 (15.09–30.09)", "Жовтень 2026"]);
  });
});

describe("distanceSeries", () => {
  const acts = [run(1, "2026-01-05 07:00:00", 10, 50, 150), run(2, "2026-01-20 07:00:00", 6, 30, 150)];
  const rows = buildReport(acts, "month", "2026-01-01", "2026-02-28");

  it("shows total per bucket, or mean per workout with gaps for empty buckets", () => {
    expect(distanceSeries(rows, "month", "total").data).toEqual([16, 0]);
    expect(distanceSeries(rows, "month", "avg").data).toEqual([8, null]);
  });
});

describe("VO2max", () => {
  it("averages only the workouts that carry an estimate", () => {
    const acts = [
      { ...run(1, "2026-01-05 07:00:00", 10, 50, 150), vo2max: 50 },
      { ...run(2, "2026-01-12 07:00:00", 10, 50, 150), vo2max: 54 },
      run(3, "2026-01-19 07:00:00", 10, 50, 150),
    ];
    const [jan, feb] = buildReport(acts, "month", "2026-01-01", "2026-02-28");
    expect(jan.avgVo2max).toBe(52);
    expect(feb.avgVo2max).toBeNull();
  });
});

describe("byRunCategory", () => {
  const acts = [
    { ...run(1, "2026-01-05 07:00:00", 10, 50, 150), is_interval: 1 },
    { ...run(2, "2026-01-06 07:00:00", 10, 50, 150), is_interval: 0 },
    run(3, "2026-01-07 07:00:00", 10, 50, 150),
  ];

  it("splits runs into intervals and steady (cross) runs; all keeps everything", () => {
    expect(byRunCategory(acts, "intervals").map((a) => a.activity_id)).toEqual([1]);
    expect(byRunCategory(acts, "cross").map((a) => a.activity_id)).toEqual([2, 3]);
    expect(byRunCategory(acts, "all")).toHaveLength(3);
  });
});
