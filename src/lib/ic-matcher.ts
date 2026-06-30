import fs from "fs";
import path from "path";

import type { IcCandidate, IcRecord, LatLng } from "@/types/route";

const IC_DATA_PATH = path.join(process.cwd(), "public", "data", "ic-kanto.json");

let cache: IcRecord[] | null = null;

function loadIcMaster(): IcRecord[] {
  if (cache) return cache;

  if (!fs.existsSync(IC_DATA_PATH)) {
    throw new Error(
      "ICデータが見つかりません。npm run import-ic を実行してください。",
    );
  }

  cache = JSON.parse(fs.readFileSync(IC_DATA_PATH, "utf-8")) as IcRecord[];
  return cache;
}

function haversineM(a: LatLng, b: LatLng): number {
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

function typePenalty(icType: IcRecord["icType"]): number {
  switch (icType) {
    case "IC":
      return 0;
    case "JCT":
      return 200;
    case "SIC":
      return 400;
    case "SA_PA":
      return 2_000;
    default:
      return 0;
  }
}

function roadNameBoost(
  ic: IcRecord,
  highwayHint: string | undefined,
): number {
  if (!highwayHint) return 0;

  const hint = highwayHint.replace(/\s+/g, "");
  const icName = ic.name.replace(/\s+/g, "");

  if (hint && icName.includes(hint.slice(0, 2))) {
    return -300;
  }

  return 0;
}

export function findNearestIcs(
  point: LatLng,
  options: {
    limit?: number;
    radiusM?: number;
    highwayHint?: string;
    preferTypes?: Array<IcRecord["icType"]>;
  } = {},
): IcCandidate[] {
  const {
    limit = 5,
    radiusM = 6_000,
    highwayHint,
    preferTypes = ["IC", "JCT", "SIC"],
  } = options;

  const master = loadIcMaster();

  const ranked = master
    .filter((ic) => preferTypes.includes(ic.icType))
    .map((ic) => {
      const distanceM = haversineM(point, ic);
      const score =
        distanceM + typePenalty(ic.icType) + roadNameBoost(ic, highwayHint);

      return { ic, distanceM, score };
    })
    .filter((item) => item.distanceM <= radiusM)
    .sort((a, b) => a.score - b.score);

  const seen = new Set<string>();
  const unique = [];

  for (const item of ranked) {
    const key = item.ic.nameDisplay;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(item);
    if (unique.length >= limit) break;
  }

  return unique.map(({ ic, distanceM }) => ({
    id: ic.id,
    name: ic.name,
    nameDisplay: ic.nameDisplay,
    icType: ic.icType,
    distanceM: Math.round(distanceM),
  }));
}

export function findIcCandidatesForPoint(
  point: LatLng,
  highwayHint?: string,
): IcCandidate[] {
  const primary = findNearestIcs(point, {
    limit: 5,
    highwayHint,
    preferTypes: ["IC", "JCT", "SIC"],
  });

  if (primary.length > 0) {
    return primary;
  }

  return findNearestIcs(point, {
    limit: 5,
    highwayHint,
    preferTypes: ["IC", "JCT", "SIC", "SA_PA"],
  });
}
