import { searchRouteIcs } from "../src/lib/ic-estimator";

const cases = [
  ["新宿", "横浜"],
  ["東京都千代田区丸の内1-1-1", "神奈川県横浜市都筑区茅ヶ崎中央2-1"],
  ["池袋", "千葉"],
  ["東京タワー", "みなとみらい"],
];

async function main() {
  for (const [origin, destination] of cases) {
    try {
      const result = await searchRouteIcs(origin, destination);
      console.log(`\n${origin} -> ${destination}`);
      console.log(`  乗り口: ${result.entryIc.nameDisplay}`);
      console.log(`  降り口: ${result.exitIc.nameDisplay}`);
      if (result.estimationNote) {
        console.log(`  注記: ${result.estimationNote}`);
      }
      console.log(
        `  候補乗り口: ${result.entryCandidates.map((c) => c.nameDisplay).join(", ")}`,
      );
      console.log(
        `  候補降り口: ${result.exitCandidates.map((c) => c.nameDisplay).join(", ")}`,
      );
    } catch (error) {
      console.log(`\n${origin} -> ${destination}`);
      console.log(
        `  ERROR: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
