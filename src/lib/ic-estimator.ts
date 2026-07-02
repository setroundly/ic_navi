import { geocodeAddress } from "@/lib/geocode";
import {
  findCorridorIcCandidates,
  findEntryExitIcsByRouteSampling,
} from "@/lib/ic-matcher";
import {
  bearingDeg,
  estimateHighwayAndLocalDistance,
  fetchDrivingRoute,
  haversineM,
  sampleRouteEvery,
} from "@/lib/route";
import type { RouteSearchResult } from "@/types/route";

const ROUTE_SAMPLE_INTERVAL_M = 500;

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
      "ルート上にIC交差が見つからなかったため、進行方向の近傍ICで推定しました。",
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
  const { highwayDistanceM, localDistanceM } =
    estimateHighwayAndLocalDistance(route.steps);
  const travelBearing = bearingDeg(origin, destination);
  const samples = sampleRouteEvery(
    route.geometry,
    route.steps,
    ROUTE_SAMPLE_INTERVAL_M,
  );
  const { entry, exit, entryCandidates, exitCandidates } =
    findEntryExitIcsByRouteSampling(samples, travelBearing);

  if (!entry || !exit) {
    if (highwayDistanceM < 500 && haversineM(origin, destination) < 15_000) {
      throw new Error(
        "高速道路の乗り口が見つかりませんでした。ルートが一般道のみの可能性があります。",
      );
    }

    return buildCorridorFallbackResult(origin, destination, route.distanceM);
  }

  return {
    origin,
    destination,
    entryIc: entry,
    exitIc: exit,
    entryCandidates,
    exitCandidates,
    distanceKm: roundKm(route.distanceM),
    durationMin: roundMin(route.durationSec),
    highwayDistanceKm: highwayDistanceM > 0 ? roundKm(highwayDistanceM) : null,
    localDistanceKm: roundKm(localDistanceM),
  };
}
