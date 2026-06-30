import { geocodeAddress } from "@/lib/geocode";
import { findIcCandidatesForPoint } from "@/lib/ic-matcher";
import {
  estimateHighwayAndLocalDistance,
  fetchDrivingRoute,
  findHighwayTransitions,
} from "@/lib/route";
import type { RouteSearchResult } from "@/types/route";

function roundKm(meters: number): number {
  return Math.round((meters / 1000) * 10) / 10;
}

function roundMin(seconds: number): number {
  return Math.round(seconds / 60);
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

  if (!entry) {
    throw new Error(
      "高速道路の乗り口が見つかりませんでした。ルートが一般道のみの可能性があります。",
    );
  }

  if (!exit) {
    throw new Error("高速道路の降り口が見つかりませんでした。");
  }

  const entryCandidates = findIcCandidatesForPoint(
    entry.location,
    entry.name || entry.ref,
  );
  const exitCandidates = findIcCandidatesForPoint(
    exit.location,
    exit.name || exit.ref,
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
    distanceKm: roundKm(route.distanceM),
    durationMin: roundMin(route.durationSec),
    highwayDistanceKm: roundKm(highwayDistanceM),
    localDistanceKm: roundKm(localDistanceM),
  };
}
