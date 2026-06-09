import "dotenv/config";
import { backfillObserverComments } from "../src/ai/backfillObserver.js";

const dryRun = process.argv.includes("--dry-run");

async function main(): Promise<void> {
  const result = await backfillObserverComments({ dryRun });

  console.log("\n=== Observer backfill ===");
  console.log(`Candidates:   ${result.candidates}`);
  console.log(`Saved:        ${result.saved}`);
  console.log(`AI null:      ${result.aiNull}`);
  console.log(`Filtered out: ${result.filteredOut}`);
  console.log(`Dry run:      ${result.dryRun}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
