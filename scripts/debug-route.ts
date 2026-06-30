import { geocodeAddress } from "../src/lib/geocode";
import { findIcCandidatesForTransition } from "../src/lib/ic-matcher";
import {
  fetchDrivingRoute,
  findHighwayTransitions,
  sliceGeometryNearPoint,
} from "../src/lib/route";

async function debugRoute(origin: string, destination: string) {
  const o = await geocodeAddress(origin);
  const d = await geocodeAddress(destination);
  console.log(`\n=== ${origin} → ${destination} ===`);
  console.log(`geocoded: ${o.address} → ${d.address}`);

  const route = await fetchDrivingRoute(o, d);
  const { entry, exit } = findHighwayTransitions(route.steps);

  console.log("\n[entry]", entry);
  console.log("[exit]", exit);

  if (entry) {
    const geometry = sliceGeometryNearPoint(route.geometry, entry.location, 4000);
    console.log(
      "entry IC:",
      findIcCandidatesForTransition(entry, geometry)
        .map((c) => c.nameDisplay)
        .join(", "),
    );
  }
  if (exit) {
    const geometry = sliceGeometryNearPoint(route.geometry, exit.location, 4000);
    console.log(
      "exit IC:",
      findIcCandidatesForTransition(exit, geometry)
        .map((c) => c.nameDisplay)
        .join(", "),
    );
  }
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
