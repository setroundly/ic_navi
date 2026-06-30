import type { LatLng } from "@/types/route";

export type RouteStep = {
  name: string;
  ref: string;
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

type OsrmManeuver = {
  type: string;
  location: [number, number];
};

type OsrmStep = {
  name?: string;
  ref?: string;
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

const HIGHWAY_PATTERN =
  /高速|自動車道|首都高|東名|中央道|関越|常磐|圏央|外環|第三京浜|横浜新道|東京湾岸|湾岸|羽田線|向島線|渋谷線|新宿線|池袋線|品川線|目黒線|深川線|三郷線|川口線|大宮線|埼玉線|高谷線|横浜北線|横羽線|保土ヶ谷|霞ヶ浦|館山道|富津|東関東|京葉|東富士|新東名|中央自動車道|関越自動車道|常磐自動車道|東北自動車道|日光宇都宮|北関東|茨城|栃木|群馬|神奈川|山梨|小田原|厚木|湘南|国道\d+号.*(バイパス|環状)/i;

export function isHighwayRoad(name: string, ref: string): boolean {
  const combined = `${name} ${ref}`.trim();
  if (!combined) return false;
  if (/^E\d+/i.test(ref)) return true;
  if (/^C\d+/i.test(ref)) return true;
  return HIGHWAY_PATTERN.test(combined);
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

  const res = await fetch(url.toString(), {
    headers: { "User-Agent": "ic-navi/1.0" },
    next: { revalidate: 0 },
  });

  if (!res.ok) {
    throw new Error("ルート検索に失敗しました");
  }

  const data = (await res.json()) as OsrmResponse;
  if (data.code !== "Ok" || !data.routes?.[0]) {
    throw new Error(data.message ?? "ルートが見つかりませんでした");
  }

  const route = data.routes[0];
  const rawSteps = route.legs?.flatMap((leg) => leg.steps ?? []) ?? [];

  const steps: RouteStep[] = rawSteps.map((step) => {
    const name = step.name ?? "";
    const ref = step.ref ?? "";
    const [lng, lat] = step.maneuver?.location ?? [0, 0];

    return {
      name,
      ref,
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
  entry: RouteStep | null;
  exit: RouteStep | null;
} {
  let entry: RouteStep | null = null;
  let exit: RouteStep | null = null;

  for (let i = 0; i < steps.length; i++) {
    const current = steps[i];
    const previous = i > 0 ? steps[i - 1] : null;
    const next = i < steps.length - 1 ? steps[i + 1] : null;

    if (!entry && current.isHighway && !previous?.isHighway) {
      entry = current;
    }

    if (current.isHighway && next && !next.isHighway) {
      exit = next;
    }
  }

  if (entry && !exit) {
    exit = steps[steps.length - 1] ?? null;
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
