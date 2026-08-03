import { createPresignedUpload, isR2Configured, listBucketSample } from "./r2.js";

async function main() {
  if (!isR2Configured()) {
    throw new Error("R2 is not configured. Fill CLOUDFLARE_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, and R2_BUCKET in backend/.env.");
  }

  const bucket = await listBucketSample();
  const testUploadUrl = await createPresignedUpload({
    key: `diagnostics/${Date.now()}-upload-test.txt`,
    contentType: "text/plain"
  });

  console.log("Cloudflare R2 credentials work.");
  console.log(JSON.stringify(bucket, null, 2));
  console.log("");
  console.log("Generated a temporary upload URL successfully.");
  console.log(`Upload URL starts with: ${testUploadUrl.slice(0, 80)}...`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
