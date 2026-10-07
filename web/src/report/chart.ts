import type { SpeedMode } from "./activityTypes";
import type { Grouping, ReportRow } from "./aggregate";
import { formatSpeedTick, rowLabel, speedTitle, speedValue } from "./format";

/** What the bars show: the bucket's total distance or the mean distance of one workout in it. */
export type DistanceView = "total" | "avg";

/** Bar values and their legend label for the chosen distance view. */
export function distanceSeries(rows: ReportRow[], grouping: Grouping, view: DistanceView) {
  if (grouping === "workout") {
    return { label: "Дистанція, км", data: rows.map((r) => Number(r.totalKm.toFixed(2))) };
  }
  if (view === "avg") {
    return {
      label: "Середня дистанція тренування, км",
      data: rows.map((r) => (r.avgKm == null ? null : Number(r.avgKm.toFixed(2)))),
    };
  }
  return { label: "Усього, км", data: rows.map((r) => (r.count > 0 ? Number(r.totalKm.toFixed(2)) : 0)) };
}

const VO2_LABEL = "Середній VO2max";

export interface ChartColors {
  km: string;
  speed: string;
  hr: string;
  vo2: string;
  text: string;
  grid: string;
}

/** Chart.js data and options: distance as bars, pace/speed and heart rate as lines on their own axes. */
export function buildChart(
  rows: ReportRow[],
  grouping: Grouping,
  mode: SpeedMode,
  colors: ChartColors,
  view: DistanceView = "total",
) {
  const isPace = mode !== "kmh";
  const distance = distanceSeries(rows, grouping, view);
  const hasVo2 = rows.some((r) => r.avgVo2max != null);
  const data = {
    labels: rows.map((r) => rowLabel(r, grouping)),
    datasets: [
      {
        type: "bar" as const,
        label: distance.label,
        data: distance.data,
        backgroundColor: colors.km,
        borderRadius: 4,
        yAxisID: "km",
        order: 3,
      },
      {
        type: "line" as const,
        label: speedTitle(mode),
        data: rows.map((r) => speedValue(r.paceSecPerKm, mode)),
        borderColor: colors.speed,
        backgroundColor: colors.speed,
        tension: 0.3,
        spanGaps: true,
        yAxisID: "speed",
        order: 1,
      },
      {
        type: "line" as const,
        label: "Середній пульс",
        data: rows.map((r) => (r.avgHr == null ? null : Math.round(r.avgHr))),
        borderColor: colors.hr,
        backgroundColor: colors.hr,
        tension: 0.3,
        spanGaps: true,
        yAxisID: "hr",
        order: 2,
      },
      // Always present, even without values: Chart.js breaks when the dataset count changes in place.
      {
        type: "line" as const,
        label: VO2_LABEL,
        data: rows.map((r) => (r.avgVo2max == null ? null : Number(r.avgVo2max.toFixed(1)))),
        borderColor: colors.vo2,
        backgroundColor: colors.vo2,
        borderDash: [6, 4],
        tension: 0.3,
        spanGaps: true,
        yAxisID: "vo2",
        order: 0,
      },
    ],
  };

  const options = {
    maintainAspectRatio: false,
    interaction: { mode: "index" as const, intersect: false },
    plugins: {
      legend: {
        labels: {
          color: colors.text,
          filter: (item: { text: string }) => hasVo2 || item.text !== VO2_LABEL,
        },
      },
      tooltip: {
        callbacks: {
          label: (ctx: { dataset: { yAxisID?: string; label?: string }; parsed: { y: number | null } }) => {
            const y = ctx.parsed.y;
            if (y == null) return `${ctx.dataset.label}: —`;
            if (ctx.dataset.yAxisID === "speed") {
              return `${ctx.dataset.label}: ${formatSpeedTick(y, mode)}${mode === "kmh" ? " км/год" : mode === "pacePer100m" ? " /100 м" : " /км"}`;
            }
            return `${ctx.dataset.label}: ${y}`;
          },
        },
      },
    },
    scales: {
      x: { ticks: { color: colors.text }, grid: { color: colors.grid } },
      km: {
        position: "left" as const,
        beginAtZero: true,
        title: { display: true, text: "км", color: colors.text },
        ticks: { color: colors.text },
        grid: { color: colors.grid },
      },
      speed: {
        position: "right" as const,
        // Faster pace is a smaller number; flip the axis so "better" is always up.
        reverse: isPace,
        // A bar chart starts every axis at zero, which flattens these lines.
        beginAtZero: false,
        grace: "10%",
        title: { display: true, text: isPace ? "темп" : "км/год", color: colors.speed },
        ticks: { color: colors.speed, callback: (v: string | number) => formatSpeedTick(Number(v), mode) },
        grid: { drawOnChartArea: false },
      },
      // A fourth visible axis would crowd the chart; VO2max values show in the tooltip.
      vo2: {
        display: false,
        beginAtZero: false,
        grace: "20%",
      },
      hr: {
        position: "right" as const,
        beginAtZero: false,
        grace: "10%",
        title: { display: true, text: "пульс", color: colors.hr },
        ticks: { color: colors.hr },
        grid: { drawOnChartArea: false },
      },
    },
  };

  return { data, options };
}
