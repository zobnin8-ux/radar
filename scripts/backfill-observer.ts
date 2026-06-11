import "dotenv/config";
import { backfillObserverComments } from "../src/ai/backfillObserver.js";

const dryRun = process.argv.includes("--dry-run");
const force = process.argv.includes("--force");

async function main(): Promise<void> {
  const result = await backfillObserverComments({ dryRun, force });

  console.log("\n=== Observer queue (2.0) ===");
  console.log(`Candidates:   ${result.candidates}`);
  console.log(`Saved:        ${result.saved}`);
  console.log(`AI null:      ${result.aiNull}`);
  console.log(`Errors:       ${result.errors}`);
  console.log(`Dry run:      ${result.dryRun}`);
  console.log(`Force:        ${force}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
