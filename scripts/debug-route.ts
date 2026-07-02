import { geocodeAddress } from "../src/lib/geocode";
import { findEntryExitIcsByRouteSampling } from "../src/lib/ic-matcher";
import {
  bearingDeg,
  fetchDrivingRoute,
  findHighwayTransitions,
  sampleRouteEvery,
} from "../src/lib/route";

async function debugRoute(origin: string, destination: string) {
  const o = await geocodeAddress(origin);
  const d = await geocodeAddress(destination);
  console.log(`\n=== ${origin} → ${destination} ===`);
  console.log(`geocoded: ${o.address} → ${d.address}`);

  const route = await fetchDrivingRoute(o, d);
  const { entry, exit } = findHighwayTransitions(route.steps);
  const samples = sampleRouteEvery(route.geometry, route.steps, 500);
  const sampled = findEntryExitIcsByRouteSampling(samples, bearingDeg(o, d));

  console.log("\n[legacy transition entry]", entry);
  console.log("[legacy transition exit]", exit);
  console.log(`[samples] ${samples.length} points every 500m`);
  console.log(`[crossings] ${sampled.crossings.length} IC(s)`);
  console.log(
    "entry IC:",
    sampled.entryCandidates.map((c) => c.nameDisplay).join(", "),
  );
  console.log(
    "exit IC:",
    sampled.exitCandidates.map((c) => c.nameDisplay).join(", "),
  );
}

async function main() {
  const cases = [
    ["新宿", "横浜"],
    ["東京都千代田区丸の内1-1-1", "神奈川県横浜市都筑区茅ヶ崎中央2-1"],
    ["池袋", "千葉"],
  ];

  for (const [origin, destination] of cases) {
    await debugRoute(origin, destination);
  }
}

main().catch(console.error);
