import type { LatLng } from "@/types/route";

export type RouteStep = {
  name: string;
  ref: string;
  destinations: string;
  exits: string;
  maneuverType: string;
  distanceM: number;
  durationSec: number;
  location: LatLng;
  isHighway: boolean;
};

export type DrivingRoute = {
  distanceM: number;
  durationSec: number;
  steps: RouteStep[];
  geometry: LatLng[];
};

export type HighwayTransition = {
  location: LatLng;
  highwayRefs: string[];
  highwayNames: string[];
  icHints: string[];
  stepIndex: number;
};

type OsrmManeuver = {
  type?: string;
  location?: [number, number];
};

type OsrmStep = {
  name?: string;
  ref?: string;
  destinations?: string;
  exits?: string;
  distance?: number;
  duration?: number;
  maneuver?: OsrmManeuver;
};

type OsrmRoute = {
  distance: number;
  duration: number;
  legs?: Array<{ steps?: OsrmStep[] }>;
  geometry?: {
    coordinates: [number, number][];
  };
};

type OsrmResponse = {
  code: string;
  routes?: OsrmRoute[];
  message?: string;
};

const EXPRESSWAY_NAME_PATTERN =
  /首都高速|高速道路|自動車道|東名(?:高速)?|中央自動車道|関越自動車道|常磐自動車道|東北自動車道|第三京浜|京葉道路|東京湾岸|横浜新道|圏央道|外環道|館山自動車道|東関東自動車道|東富士道路|新東名|向島線|湾岸道路/i;

const SHUTO_NAMED_LINE_PATTERN =
  /首都高速(?:\d+号)?(?:池袋|渋谷|品川|横浜北|湾岸|目黒|向島|三郷|川口|大宮|埼玉|高谷|深川|東神奈川|駒形|新宿|高樹|茅場|中央環状)線/i;

const NON_HIGHWAY_NAME_PATTERN =
  /街道|通り$|裏通り|側道|駅前|歩道|隧道|橋$|坂$|国道\d+号(?![^]*環状)(?![^]*バイパス)/;

const RAMP_IC_NAME_PATTERN = /(.+?)(?:IC|ＩＣ|出入口|出口|入口|ランプ|JCT|ジャンクション)/i;

export function isHighwayRoad(name: string, ref: string): boolean {
  const roadName = name.trim();
  const roadRef = ref.trim();

  if (!roadName && !roadRef) return false;

  if (/^E\d+[A-Z]?$/i.test(roadRef)) return true;
  if (/^C\d+$/i.test(roadRef)) return true;

  if (
    NON_HIGHWAY_NAME_PATTERN.test(roadName) &&
    !EXPRESSWAY_NAME_PATTERN.test(roadName)
  ) {
    return false;
  }

  if (EXPRESSWAY_NAME_PATTERN.test(roadName)) return true;
  if (SHUTO_NAMED_LINE_PATTERN.test(roadName)) return true;

  if (/^\d+号/.test(roadRef) && /首都高速|高速/.test(roadName)) {
    return true;
  }

  return false;
}

export function parseIcHints(...sources: Array<string | undefined>): string[] {
  const hints = new Set<string>();

  for (const source of sources) {
    if (!source) continue;

    for (const chunk of source.split(/[,、;；]/)) {
      const trimmed = chunk.trim();
      if (!trimmed) continue;

      hints.add(trimmed);

      const rampMatch = trimmed.match(RAMP_IC_NAME_PATTERN);
      if (rampMatch?.[1]) {
        hints.add(rampMatch[1].trim());
      }
    }
  }

  return [...hints].filter((hint) => hint.length >= 2);
}

function collectHighwayMetadata(steps: RouteStep[], index: number) {
  const refs = new Set<string>();
  const names = new Set<string>();

  for (let i = index; i < steps.length; i++) {
    if (!steps[i].isHighway) break;
    if (steps[i].ref) refs.add(steps[i].ref);
    if (steps[i].name) names.add(steps[i].name);
  }

  for (let i = index; i >= 0; i--) {
    if (!steps[i].isHighway) break;
    if (steps[i].ref) refs.add(steps[i].ref);
    if (steps[i].name) names.add(steps[i].name);
  }

  return {
    highwayRefs: [...refs],
    highwayNames: [...names],
  };
}

export async function fetchDrivingRoute(
  origin: LatLng,
  destination: LatLng,
): Promise<DrivingRoute> {
  const coords = `${origin.lng},${origin.lat};${destination.lng},${destination.lat}`;
  const url = new URL(
    `https://router.project-osrm.org/route/v1/driving/${coords}`,
  );
  url.searchParams.set("overview", "full");
  url.searchParams.set("geometries", "geojson");
  url.searchParams.set("steps", "true");
  url.searchParams.set("annotations", "false");
  url.searchParams.set("alternatives", "3");

  const res = await fetch(url.toString(), {
    headers: { "User-Agent": "ic-navi/1.0" },
    next: { revalidate: 0 },
  });

  if (!res.ok) {
    throw new Error("ルート検索に失敗しました");
  }

  const data = (await res.json()) as OsrmResponse;
  if (data.code !== "Ok" || !data.routes?.length) {
    throw new Error(data.message ?? "ルートが見つかりませんでした");
  }

  const routes = data.routes
    .map((route) => parseOsrmRoute(route))
    .sort((a, b) => scoreRouteForHighways(b) - scoreRouteForHighways(a));

  return routes[0];
}

function scoreRouteForHighways(route: DrivingRoute): number {
  const { highwayDistanceM } = estimateHighwayAndLocalDistance(route.steps);
  const { entry, exit } = findHighwayTransitions(route.steps);
  let score = highwayDistanceM;

  if (entry) score += 2_000;
  if (exit) score += 2_000;
  if (entry && exit && entry.stepIndex < exit.stepIndex) score += 1_000;

  return score;
}

function parseOsrmRoute(route: OsrmRoute): DrivingRoute {
  const rawSteps = route.legs?.flatMap((leg) => leg.steps ?? []) ?? [];

  const steps: RouteStep[] = rawSteps.map((step) => {
    const name = step.name ?? "";
    const ref = step.ref ?? "";
    const [lng, lat] = step.maneuver?.location ?? [0, 0];

    return {
      name,
      ref,
      destinations: step.destinations ?? "",
      exits: step.exits ?? "",
      maneuverType: step.maneuver?.type ?? "",
      distanceM: step.distance ?? 0,
      durationSec: step.duration ?? 0,
      location: { lat, lng },
      isHighway: isHighwayRoad(name, ref),
    };
  });

  const geometry =
    route.geometry?.coordinates.map(([lng, lat]) => ({ lat, lng })) ?? [];

  return {
    distanceM: route.distance,
    durationSec: route.duration,
    steps,
    geometry,
  };
}

export function findHighwayTransitions(steps: RouteStep[]): {
  entry: HighwayTransition | null;
  exit: HighwayTransition | null;
} {
  let entry: HighwayTransition | null = null;
  let exit: HighwayTransition | null = null;

  for (let i = 0; i < steps.length; i++) {
    const current = steps[i];
    const previous = i > 0 ? steps[i - 1] : null;
    const next = i < steps.length - 1 ? steps[i + 1] : null;

    const enteringHighway =
      current.isHighway && (previous === null || !previous.isHighway);
    const leavingHighway =
      previous?.isHighway === true &&
      current.isHighway === false &&
      current.maneuverType !== "arrive";

    if (!entry && enteringHighway) {
      const metadata = collectHighwayMetadata(steps, i);
      entry = {
        location: current.location,
        stepIndex: i,
        icHints: parseIcHints(
          current.destinations,
          current.exits,
          current.name,
          next?.destinations,
          next?.name,
        ),
        ...metadata,
      };
    }

    if (leavingHighway) {
      const metadata = collectHighwayMetadata(steps, i - 1);
      exit = {
        location: current.location,
        stepIndex: i,
        icHints: parseIcHints(
          current.destinations,
          current.exits,
          current.name,
          previous?.destinations,
          previous?.name,
        ),
        ...metadata,
      };
    }
  }

  if (entry && !exit) {
    const lastStep = steps[steps.length - 1];
    if (lastStep) {
      const metadata = collectHighwayMetadata(steps, steps.length - 1);
      exit = {
        location: lastStep.location,
        stepIndex: steps.length - 1,
        icHints: parseIcHints(lastStep.destinations, lastStep.exits, lastStep.name),
        ...metadata,
      };
    }
  }

  return { entry, exit };
}

export function estimateHighwayAndLocalDistance(steps: RouteStep[]): {
  highwayDistanceM: number;
  localDistanceM: number;
} {
  let highwayDistanceM = 0;
  let localDistanceM = 0;

  for (const step of steps) {
    if (step.isHighway) {
      highwayDistanceM += step.distanceM;
    } else {
      localDistanceM += step.distanceM;
    }
  }

  return { highwayDistanceM, localDistanceM };
}

export function sliceGeometryNearPoint(
  geometry: LatLng[],
  point: LatLng,
  radiusM = 3_000,
): LatLng[] {
  if (geometry.length === 0) return [point];

  let bestIndex = 0;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (let i = 0; i < geometry.length; i++) {
    const distance = haversineM(geometry[i], point);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = i;
    }
  }

  const result: LatLng[] = [];
  let accumulated = 0;

  result.push(geometry[bestIndex]);

  for (let i = bestIndex - 1; i >= 0; i--) {
    accumulated += haversineM(geometry[i], geometry[i + 1]);
    if (accumulated > radiusM) break;
    result.unshift(geometry[i]);
  }

  accumulated = 0;
  for (let i = bestIndex + 1; i < geometry.length; i++) {
    accumulated += haversineM(geometry[i - 1], geometry[i]);
    if (accumulated > radiusM) break;
    result.push(geometry[i]);
  }

  return result;
}

export function haversineM(a: LatLng, b: LatLng): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const earthRadiusM = 6_371_000;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;

  return 2 * earthRadiusM * Math.asin(Math.sqrt(h));
}

export function minDistanceToPolylineM(
  point: LatLng,
  polyline: LatLng[],
): number {
  if (polyline.length === 0) {
    return Number.POSITIVE_INFINITY;
  }

  if (polyline.length === 1) {
    return haversineM(point, polyline[0]);
  }

  let min = Number.POSITIVE_INFINITY;
  for (let i = 0; i < polyline.length - 1; i++) {
    min = Math.min(min, distancePointToSegmentM(point, polyline[i], polyline[i + 1]));
  }

  return min;
}

function distancePointToSegmentM(
  point: LatLng,
  start: LatLng,
  end: LatLng,
): number {
  const dx = end.lng - start.lng;
  const dy = end.lat - start.lat;

  if (dx === 0 && dy === 0) {
    return haversineM(point, start);
  }

  const t = Math.max(
    0,
    Math.min(
      1,
      ((point.lng - start.lng) * dx + (point.lat - start.lat) * dy) /
        (dx * dx + dy * dy),
    ),
  );

  const projection = {
    lat: start.lat + t * dy,
    lng: start.lng + t * dx,
  };

  return haversineM(point, projection);
}
