// Garmin typeKeys grouped into the sports a person thinks in.
// A typeKey that is not listed here is offered as its own option, never
// silently folded into a family it may not belong to.
export const FAMILIES = {
  running: {
    label: "Біг",
    speedMode: "pacePerKm",
    typeKeys: [
      "running",
      "treadmill_running",
      "trail_running",
      "track_running",
      "street_running",
      "indoor_running",
      "virtual_run",
      "ultra_run",
      "obstacle_run",
    ],
  },
  cycling: {
    label: "Велосипед",
    speedMode: "kmh",
    typeKeys: [
      "cycling",
      "road_biking",
      "mountain_biking",
      "gravel_cycling",
      "indoor_cycling",
      "virtual_ride",
      "cyclocross",
      "track_cycling",
      "recumbent_cycling",
      "downhill_biking",
      "e_bike_fitness",
      "e_bike_mountain",
    ],
  },
  swimming: {
    label: "Плавання",
    speedMode: "pacePer100m",
    typeKeys: ["lap_swimming", "open_water_swimming", "swimming"],
  },
  walking: {
    label: "Ходьба",
    speedMode: "pacePerKm",
    typeKeys: ["walking", "casual_walking", "speed_walking"],
  },
  hiking: {
    label: "Хайкінг",
    speedMode: "pacePerKm",
    typeKeys: ["hiking"],
  },
} as const satisfies Record<string, { label: string; speedMode: SpeedMode; typeKeys: readonly string[] }>;

export type SpeedMode = "pacePerKm" | "pacePer100m" | "kmh";

export interface ActivityFilter {
  id: string;
  label: string;
  typeKeys: string[];
  speedMode: SpeedMode;
}

function humanize(typeKey: string): string {
  const text = typeKey.replace(/_/g, " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Filters to offer for the type keys present in the data, most frequent first. */
export function buildFilters(typeKeyCounts: Map<string, number>): ActivityFilter[] {
  const result: { filter: ActivityFilter; count: number }[] = [];
  const claimed = new Set<string>();

  for (const [id, family] of Object.entries(FAMILIES)) {
    const keys = family.typeKeys.filter((k) => typeKeyCounts.has(k));
    keys.forEach((k) => claimed.add(k));
    if (keys.length === 0) continue;
    const count = keys.reduce((sum, k) => sum + (typeKeyCounts.get(k) ?? 0), 0);
    result.push({
      filter: { id, label: family.label, typeKeys: [...family.typeKeys], speedMode: family.speedMode },
      count,
    });
  }

  for (const [typeKey, count] of typeKeyCounts) {
    if (claimed.has(typeKey)) continue;
    result.push({
      filter: { id: `type:${typeKey}`, label: humanize(typeKey), typeKeys: [typeKey], speedMode: "pacePerKm" },
      count,
    });
  }

  return result.sort((a, b) => b.count - a.count).map((r) => r.filter);
}
