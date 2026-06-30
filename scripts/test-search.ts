import { searchRouteIcs } from "../src/lib/ic-estimator";

async function main() {
  const result = await searchRouteIcs(
    "東京都千代田区丸の内1-1-1",
    "神奈川県横浜市都筑区茅ヶ崎中央2-1",
  );

  console.log("乗り口:", result.entryIc.nameDisplay);
  console.log("降り口:", result.exitIc.nameDisplay);
  console.log(
    "候補乗り口:",
    result.entryCandidates.map((c) => c.nameDisplay).join(", "),
  );
  console.log(
    "候補降り口:",
    result.exitCandidates.map((c) => c.nameDisplay).join(", "),
  );
  console.log("距離:", result.distanceKm, "km /", result.durationMin, "分");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
