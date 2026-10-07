import type { SpeedMode } from "./activityTypes";
import type { Grouping, ReportRow } from "./aggregate";
import { formatSpeedTick, rowLabel, speedTitle, speedValue } from "./format";

export interface ChartColors {
  km: string;
  speed: string;
  hr: string;
  text: string;
  grid: string;
}

/** Chart.js data and options: distance as bars, pace/speed and heart rate as lines on their own axes. */
export function buildChart(rows: ReportRow[], grouping: Grouping, mode: SpeedMode, colors: ChartColors) {
  const isPace = mode !== "kmh";
  const data = {
    labels: rows.map((r) => rowLabel(r, grouping)),
    datasets: [
      {
        type: "bar" as const,
        label: grouping === "workout" ? "Дистанція, км" : "Усього, км",
        data: rows.map((r) => (r.count > 0 ? Number(r.totalKm.toFixed(2)) : 0)),
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
    ],
  };

  const options = {
    maintainAspectRatio: false,
    interaction: { mode: "index" as const, intersect: false },
    plugins: {
      legend: { labels: { color: colors.text } },
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
