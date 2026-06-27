import { runBatchPublish } from "../src/pipeline/runBatchPublish.js";
import { runPipeline } from "../src/pipeline/runPipeline.js";
import { clearPublicationQueue } from "../src/storage/newsStore.js";
import { countPublishQueue } from "../src/storage/newsStore.js";

const publishCount = Math.max(1, parseInt(process.argv[2] ?? "3", 10));

async function main(): Promise<void> {
  const cleared = await clearPublicationQueue("Manual clear before collect");
  console.log(`Queue cleared: ${cleared} item(s)`);

  console.log("Collecting products (pipeline)...");
  const pipeline = await runPipeline({ trigger: "manual", dryRun: false });
  console.log(pipeline.message);

  const queueSize = await countPublishQueue();
  console.log(`Queue after collect: ${queueSize}`);

  if (queueSize === 0) {
    console.log("Nothing to publish — queue empty after collect.");
    process.exit(0);
  }

  const toPublish = Math.min(publishCount, queueSize);
  console.log(`Publishing ${toPublish} post(s)...`);
  const batch = await runBatchPublish({
    count: toPublish,
    trigger: "manual",
    dryRun: false,
  });
  console.log(batch.message);
  process.exit(batch.success ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
