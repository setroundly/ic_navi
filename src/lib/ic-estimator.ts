import { geocodeAddress } from "@/lib/geocode";
import {
  findCorridorIcCandidates,
  findIcCandidatesForTransition,
} from "@/lib/ic-matcher";
import {
  estimateHighwayAndLocalDistance,
  fetchDrivingRoute,
  findHighwayTransitions,
  haversineM,
  sliceGeometryNearPoint,
} from "@/lib/route";
import type { RouteSearchResult } from "@/types/route";

function roundKm(meters: number): number {
  return Math.round((meters / 1000) * 10) / 10;
}

function roundMin(seconds: number): number {
  return Math.round(seconds / 60);
}

function buildCorridorFallbackResult(
  origin: Awaited<ReturnType<typeof geocodeAddress>>,
  destination: Awaited<ReturnType<typeof geocodeAddress>>,
  routeDistanceM: number,
): RouteSearchResult {
  const entryCandidates = findCorridorIcCandidates(
    origin,
    destination,
    "entry",
  );
  const exitCandidates = findCorridorIcCandidates(
    origin,
    destination,
    "exit",
  );

  if (entryCandidates.length === 0 || exitCandidates.length === 0) {
    throw new Error("最寄りのICが見つかりませんでした。");
  }

  return {
    origin,
    destination,
    entryIc: entryCandidates[0],
    exitIc: exitCandidates[0],
    entryCandidates,
    exitCandidates,
    distanceKm: roundKm(routeDistanceM),
    durationMin: roundMin(routeDistanceM / 8.3),
    highwayDistanceKm: null,
    localDistanceKm: roundKm(routeDistanceM),
    estimationNote:
      "ルート上に高速区間が見つからなかったため、進行方向の近傍ICで推定しました。",
  };
}

export async function searchRouteIcs(
  originAddress: string,
  destinationAddress: string,
): Promise<RouteSearchResult> {
  const [origin, destination] = await Promise.all([
    geocodeAddress(originAddress),
    geocodeAddress(destinationAddress),
  ]);

  const route = await fetchDrivingRoute(origin, destination);
  const { entry, exit } = findHighwayTransitions(route.steps);
  const { highwayDistanceM, localDistanceM } =
    estimateHighwayAndLocalDistance(route.steps);

  if (!entry || highwayDistanceM < 500) {
    if (haversineM(origin, destination) < 15_000) {
      throw new Error(
        "高速道路の乗り口が見つかりませんでした。ルートが一般道のみの可能性があります。",
      );
    }

    return buildCorridorFallbackResult(origin, destination, route.distanceM);
  }

  if (!exit) {
    throw new Error("高速道路の降り口が見つかりませんでした。");
  }

  const entryGeometry = sliceGeometryNearPoint(
    route.geometry,
    entry.location,
    4_000,
  );
  const exitGeometry = sliceGeometryNearPoint(
    route.geometry,
    exit.location,
    4_000,
  );

  const entryCandidates = findIcCandidatesForTransition(entry, entryGeometry);
  const exitCandidates = findIcCandidatesForTransition(exit, exitGeometry);

  if (entryCandidates.length === 0 || exitCandidates.length === 0) {
    if (haversineM(origin, destination) >= 15_000) {
      return buildCorridorFallbackResult(origin, destination, route.distanceM);
    }

    throw new Error("最寄りのICが見つかりませんでした。");
  }

  return {
    origin,
    destination,
    entryIc: entryCandidates[0],
    exitIc: exitCandidates[0],
    entryCandidates,
    exitCandidates,
    distanceKm: roundKm(route.distanceM),
    durationMin: roundMin(route.durationSec),
    highwayDistanceKm: roundKm(highwayDistanceM),
    localDistanceKm: roundKm(localDistanceM),
  };
}
