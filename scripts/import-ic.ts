import fs from "fs";
import path from "path";

const BBOXES: Array<{ name: string; south: number; west: number; north: number; east: number }> = [
  { name: "tokyo", south: 35.45, west: 138.95, north: 35.95, east: 139.95 },
  { name: "kanagawa", south: 35.1, west: 139.0, north: 35.65, east: 139.75 },
  { name: "saitama", south: 35.75, west: 138.85, north: 36.35, east: 139.85 },
  { name: "chiba", south: 35.0, west: 139.75, north: 35.85, east: 140.9 },
  { name: "ibaraki", south: 35.95, west: 139.75, north: 36.95, east: 140.85 },
  { name: "tochigi", south: 36.2, west: 139.45, north: 37.1, east: 140.2 },
  { name: "gunma", south: 36.0, west: 138.75, north: 36.85, east: 139.55 },
];

type OsmElement = {
  id: number;
  lat: number;
  lon: number;
  tags?: { name?: string; ref?: string };
};

type IcRecord = {
  id: string;
  name: string;
  nameDisplay: string;
  ref: string | null;
  icType: "IC" | "JCT" | "SA_PA" | "SIC";
  lat: number;
  lng: number;
};

function classifyIcType(name: string): IcRecord["icType"] {
  if (/JCT/i.test(name) || /ジャンクション/.test(name)) return "JCT";
  if (/SA|サービスエリア|パーキング|PA\b|道の駅/.test(name)) return "SA_PA";
  if (/スマートIC|SIC/i.test(name)) return "SIC";
  return "IC";
}

function toDisplayName(name: string, icType: IcRecord["icType"]): string {
  if (icType !== "IC") return name;
  if (/IC$/i.test(name) || /ＩＣ$/.test(name)) return name;
  return `${name}IC`;
}

function shouldSkip(name: string): boolean {
  return /予定地|未開通|仮称/.test(name);
}

async function fetchBbox(bbox: (typeof BBOXES)[0]): Promise<OsmElement[]> {
  const query = `[out:json][timeout:90];
node["highway"="motorway_junction"](${bbox.south},${bbox.west},${bbox.north},${bbox.east});
out body;`;

  const endpoints = [
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass-api.de/api/interpreter",
  ];

  for (const endpoint of endpoints) {
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": "ic-navi-import/1.0",
        },
        body: `data=${encodeURIComponent(query)}`,
        signal: AbortSignal.timeout(120_000),
      });

      if (!res.ok) {
        console.warn(`${endpoint} returned ${res.status} for ${bbox.name}`);
        continue;
      }

      const data = (await res.json()) as { elements?: OsmElement[] };
      console.log(`  ${bbox.name}: ${data.elements?.length ?? 0} nodes`);
      return data.elements ?? [];
    } catch (err) {
      console.warn(`${endpoint} failed for ${bbox.name}:`, err);
    }
  }

  throw new Error(`All endpoints failed for ${bbox.name}`);
}

async function main() {
  const byId = new Map<string, IcRecord>();

  for (const bbox of BBOXES) {
    console.log(`Fetching ${bbox.name}...`);
    const elements = await fetchBbox(bbox);

    for (const e of elements) {
      if (!e.tags?.name || shouldSkip(e.tags.name)) continue;
      const name = e.tags.name;
      const icType = classifyIcType(name);
      byId.set(String(e.id), {
        id: String(e.id),
        name,
        nameDisplay: toDisplayName(name, icType),
        ref: e.tags.ref ?? null,
        icType,
        lat: e.lat,
        lng: e.lon,
      });
    }

    await new Promise((r) => setTimeout(r, 1500));
  }

  const items = [...byId.values()].sort((a, b) =>
    a.name.localeCompare(b.name, "ja"),
  );

  const outDir = path.join(process.cwd(), "public", "data");
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(
    path.join(outDir, "ic-kanto.json"),
    JSON.stringify(items),
    "utf-8",
  );

  console.log(`Saved ${items.length} IC records to public/data/ic-kanto.json`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
