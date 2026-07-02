import fs from "fs";
import path from "path";

import {
  angleDiffDeg,
  bearingDeg,
  haversineM,
  minDistanceToPolylineM,
  type HighwayTransition,
  type RouteSample,
} from "@/lib/route";
import type { IcCandidate, IcRecord, LatLng } from "@/types/route";

const IC_DATA_PATH = path.join(process.cwd(), "public", "data", "ic-kanto.json");

const SKIP_NAME_PATTERN = /予定地|未開通|仮称|ダミー/;
const EXIT_ONLY_PATTERN = /^(?:.*)(出口|入口|ランプ)$/;

let cache: IcRecord[] | null = null;

function loadIcMaster(): IcRecord[] {
  if (cache) return cache;

  if (!fs.existsSync(IC_DATA_PATH)) {
    throw new Error(
      "ICデータが見つかりません。npm run import-ic を実行してください。",
    );
  }

  const raw = JSON.parse(fs.readFileSync(IC_DATA_PATH, "utf-8")) as IcRecord[];
  cache = dedupeIcRecords(
    raw.filter((ic) => !SKIP_NAME_PATTERN.test(ic.name)),
  );
  return cache;
}

function dedupeIcRecords(records: IcRecord[]): IcRecord[] {
  const byKey = new Map<string, IcRecord>();

  for (const ic of records) {
    const key = `${normalizeIcName(ic.name)}:${Math.round(ic.lat * 1000)}:${Math.round(ic.lng * 1000)}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, ic);
      continue;
    }

    if (scoreIcType(ic.icType) < scoreIcType(existing.icType)) {
      byKey.set(key, ic);
    }
  }

  return [...byKey.values()];
}

function scoreIcType(icType: IcRecord["icType"]): number {
  switch (icType) {
    case "IC":
      return 0;
    case "SIC":
      return 1;
    case "JCT":
      return 2;
    case "SA_PA":
      return 3;
    default:
      return 4;
  }
}

const SAMPLE_CROSSING_THRESHOLD_M = 500;
const PREFERRED_IC_TYPES: Array<IcRecord["icType"]> = ["IC", "JCT", "SIC"];

type IcCrossing = {
  ic: IcRecord;
  sampleIndex: number;
  distanceM: number;
  cumulativeDistanceM: number;
};

function isDirectionConsistent(
  sample: RouteSample,
  ic: IcRecord,
  travelBearing: number,
): boolean {
  const routeVsTravel = angleDiffDeg(sample.bearing, travelBearing);
  if (routeVsTravel > 90) {
    return false;
  }

  const toIcBearing = bearingDeg(sample.point, ic);
  const sideAngle = angleDiffDeg(sample.bearing, toIcBearing);

  if (sideAngle < 45 || sideAngle > 135) {
    return false;
  }

  if (sample.isHighway) {
    return routeVsTravel <= 60;
  }

  return true;
}

function toIcCandidate(crossing: IcCrossing): IcCandidate {
  return {
    id: crossing.ic.id,
    name: crossing.ic.name,
    nameDisplay: crossing.ic.nameDisplay,
    icType: crossing.ic.icType,
    distanceM: Math.round(crossing.distanceM),
  };
}

function uniqueCandidates(crossings: IcCrossing[]): IcCandidate[] {
  const seen = new Set<string>();
  const candidates: IcCandidate[] = [];

  for (const crossing of crossings) {
    const key = normalizeIcName(crossing.ic.name);
    if (seen.has(key)) continue;
    seen.add(key);
    candidates.push(toIcCandidate(crossing));
    if (candidates.length >= 5) break;
  }

  return candidates;
}

export function findEntryExitIcsByRouteSampling(
  samples: RouteSample[],
  travelBearing: number,
): {
  entry: IcCandidate | null;
  exit: IcCandidate | null;
  entryCandidates: IcCandidate[];
  exitCandidates: IcCandidate[];
  crossings: IcCrossing[];
} {
  const master = loadIcMaster().filter((ic) =>
    PREFERRED_IC_TYPES.includes(ic.icType),
  );

  const crossings: IcCrossing[] = [];
  let lastIcId: string | null = null;

  for (let i = 0; i < samples.length; i++) {
    const sample = samples[i];
    let nearest: IcCrossing | null = null;

    for (const ic of master) {
      const distanceM = haversineM(sample.point, ic);
      if (distanceM > SAMPLE_CROSSING_THRESHOLD_M) continue;
      if (!isDirectionConsistent(sample, ic, travelBearing)) continue;

      if (!nearest || distanceM < nearest.distanceM) {
        nearest = {
          ic,
          sampleIndex: i,
          distanceM,
          cumulativeDistanceM: sample.cumulativeDistanceM,
        };
      }
    }

    if (!nearest) {
      lastIcId = null;
      continue;
    }

    if (nearest.ic.id === lastIcId) continue;

    lastIcId = nearest.ic.id;
    crossings.push(nearest);
  }

  if (crossings.length === 0) {
    return {
      entry: null,
      exit: null,
      entryCandidates: [],
      exitCandidates: [],
      crossings: [],
    };
  }

  const entryCrossing = crossings[0];
  const exitCrossing = crossings[crossings.length - 1];

  return {
    entry: toIcCandidate(entryCrossing),
    exit: toIcCandidate(exitCrossing),
    entryCandidates: uniqueCandidates(crossings),
    exitCandidates: uniqueCandidates([...crossings].reverse()),
    crossings,
  };
}

export function normalizeIcName(name: string): string {
  return name
    .normalize("NFKC")
    .replace(/[\s　]/g, "")
    .replace(/ＩＣ/g, "IC")
    .replace(/IC$/i, "")
    .replace(/(出入口|出口|入口|ランプ|JCT|ジャンクション)$/i, "")
    .toLowerCase();
}

function typePenalty(icType: IcRecord["icType"]): number {
  switch (icType) {
    case "IC":
      return 0;
    case "SIC":
      return 250;
    case "JCT":
      return 500;
    case "SA_PA":
      return 2_500;
    default:
      return 0;
  }
}

function hintMatchScore(ic: IcRecord, hints: string[]): number {
  if (hints.length === 0) return 0;

  const icNames = [
    normalizeIcName(ic.name),
    normalizeIcName(ic.nameDisplay),
  ];

  let best = 0;
  for (const hint of hints) {
    const normalizedHint = normalizeIcName(hint);
    if (!normalizedHint) continue;

    for (const icName of icNames) {
      if (icName === normalizedHint) {
        best = Math.max(best, 8_000);
      } else if (
        icName.includes(normalizedHint) ||
        normalizedHint.includes(icName)
      ) {
        best = Math.max(best, 5_000);
      } else if (
        normalizedHint.length >= 3 &&
        (icName.startsWith(normalizedHint) ||
          normalizedHint.startsWith(icName))
      ) {
        best = Math.max(best, 3_000);
      }
    }
  }

  return best;
}

function highwayRefMatchScore(ic: IcRecord, highwayRefs: string[]): number {
  if (!ic.ref || highwayRefs.length === 0) return 0;

  const icRef = ic.ref.trim().toUpperCase();
  for (const ref of highwayRefs) {
    const normalizedRef = ref.trim().toUpperCase();
    if (!normalizedRef) continue;
    if (icRef === normalizedRef) return 2_500;
    if (icRef.includes(normalizedRef) || normalizedRef.includes(icRef)) {
      return 1_200;
    }
  }

  return 0;
}

function highwayNameMatchScore(
  ic: IcRecord,
  highwayNames: string[],
): number {
  if (highwayNames.length === 0) return 0;

  const icName = normalizeIcName(ic.name);
  let best = 0;

  for (const highwayName of highwayNames) {
    const normalizedHighway = normalizeIcName(highwayName);
    if (!normalizedHighway) continue;

    if (
      normalizedHighway.includes(icName) ||
      icName.includes(normalizedHighway.slice(0, 3))
    ) {
      best = Math.max(best, 400);
    }
  }

  return best;
}

function exitOnlyPenalty(ic: IcRecord): number {
  if (ic.icType !== "IC") return 0;
  if (EXIT_ONLY_PATTERN.test(ic.name) && !/IC/i.test(ic.name)) {
    return 1_000;
  }
  return 0;
}

function rankIcCandidates(
  point: LatLng,
  options: {
    limit?: number;
    radiusM?: number;
    highwayRefs?: string[];
    highwayNames?: string[];
    icHints?: string[];
    geometryWindow?: LatLng[];
    preferTypes?: Array<IcRecord["icType"]>;
  },
): IcCandidate[] {
  const {
    limit = 5,
    radiusM = 8_000,
    highwayRefs = [],
    highwayNames = [],
    icHints = [],
    geometryWindow = [],
    preferTypes = ["IC", "JCT", "SIC"],
  } = options;

  const master = loadIcMaster();

  const ranked = master
    .filter((ic) => preferTypes.includes(ic.icType))
    .map((ic) => {
      const directDistanceM = haversineM(point, ic);
      const routeDistanceM =
        geometryWindow.length > 0
          ? minDistanceToPolylineM(ic, geometryWindow)
          : directDistanceM;
      const distanceM = Math.min(directDistanceM, routeDistanceM);

      const score =
        distanceM +
        typePenalty(ic.icType) +
        exitOnlyPenalty(ic) -
        hintMatchScore(ic, icHints) -
        highwayRefMatchScore(ic, highwayRefs) -
        highwayNameMatchScore(ic, highwayNames);

      return { ic, distanceM, score };
    })
    .filter((item) => item.distanceM <= radiusM)
    .sort((a, b) => a.score - b.score);

  const seen = new Set<string>();
  const unique = [];

  for (const item of ranked) {
    const key = normalizeIcName(item.ic.name);
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

export function findIcCandidatesForTransition(
  transition: HighwayTransition,
  geometryWindow: LatLng[],
): IcCandidate[] {
  const master = loadIcMaster();
  const ranked = rankIcCandidates(transition.location, {
    limit: 12,
    radiusM: 12_000,
    highwayRefs: transition.highwayRefs,
    highwayNames: transition.highwayNames,
    icHints: transition.icHints,
    geometryWindow,
    preferTypes: ["IC", "JCT", "SIC"],
  });

  const rankedById = new Map(ranked.map((candidate) => [candidate.id, candidate]));

  const hinted = master
    .filter((ic) => hintMatchScore(ic, transition.icHints) >= 3_000)
    .map((ic) => rankedById.get(ic.id))
    .filter((candidate): candidate is IcCandidate => Boolean(candidate));

  const merged = [...hinted, ...ranked];
  const seen = new Set<string>();

  return merged
    .filter((candidate) => {
      const key = normalizeIcName(candidate.name);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 5);
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
  const { highwayHint, ...rest } = options;
  return rankIcCandidates(point, {
    ...rest,
    icHints: highwayHint ? [highwayHint] : [],
  });
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

export function findCorridorIcCandidates(
  origin: LatLng,
  destination: LatLng,
  role: "entry" | "exit",
): IcCandidate[] {
  const master = loadIcMaster();
  const travelBearing = bearingDeg(origin, destination);
  const target = role === "entry" ? origin : destination;
  const preferredBearing =
    role === "entry" ? travelBearing : (travelBearing + 180) % 360;
  const maxDistanceM = role === "entry" ? 18_000 : 15_000;

  const ranked = master
    .filter((ic) => ic.icType === "IC" || ic.icType === "JCT" || ic.icType === "SIC")
    .map((ic) => {
      const distanceM = haversineM(target, ic);
      const directionBearing = bearingDeg(target, ic);
      const anglePenalty = angleDiffDeg(preferredBearing, directionBearing) * 80;

      return {
        ic,
        distanceM,
        score: distanceM + anglePenalty + typePenalty(ic.icType) + exitOnlyPenalty(ic),
      };
    })
    .filter((item) => item.distanceM <= maxDistanceM)
    .sort((a, b) => a.score - b.score);

  const seen = new Set<string>();
  const unique = [];

  for (const item of ranked) {
    const key = normalizeIcName(item.ic.name);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(item);
    if (unique.length >= 5) break;
  }

  return unique.map(({ ic, distanceM }) => ({
    id: ic.id,
    name: ic.name,
    nameDisplay: ic.nameDisplay,
    icType: ic.icType,
    distanceM: Math.round(distanceM),
  }));
}
