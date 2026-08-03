import { config } from "./config.js";
import { graphFetch } from "./graph.js";

const ownerEmail = config.ownerEmail || "shradaya.poudel@gallimaps.com";
const tenantHostCandidates = [
  "galliexpress-my.sharepoint.com",
  "galliexpress.sharepoint.com"
];
const personalPathCandidates = [
  "personal/shradaya_poudel_gallimaps_com",
  `personal/${ownerEmail.replace("@", "_").replace(/\./g, "_")}`
];

async function tryRequest(label, path, mapper = (data) => data) {
  try {
    const data = await graphFetch(path);
    return {
      ok: true,
      label,
      path,
      data: mapper(data)
    };
  } catch (error) {
    return {
      ok: false,
      label,
      path,
      error: error.message.replace(/\s+/g, " ").slice(0, 500)
    };
  }
}

function summarizeDrive(data) {
  return {
    id: data.id,
    name: data.name,
    driveType: data.driveType,
    webUrl: data.webUrl,
    owner: data.owner?.user?.email || data.owner?.user?.displayName || data.owner
  };
}

function summarizeSite(data) {
  return {
    id: data.id,
    name: data.name,
    displayName: data.displayName,
    webUrl: data.webUrl
  };
}

function printResult(result) {
  console.log("");
  console.log(`${result.ok ? "OK" : "FAIL"} ${result.label}`);
  console.log(result.path);
  if (result.ok) {
    console.log(JSON.stringify(result.data, null, 2));
  } else {
    console.log(result.error);
  }
}

async function main() {
  console.log("Discovering OneDrive/SharePoint drive with backend app credentials...");
  console.log(`Owner email: ${ownerEmail}`);
  console.log("Client secret is loaded from .env and will not be printed.");

  const attempts = [];

  attempts.push(await tryRequest(
    "Owner user drive",
    `/users/${encodeURIComponent(ownerEmail)}/drive`,
    summarizeDrive
  ));

  attempts.push(await tryRequest(
    "Root organization SharePoint site",
    "/sites/root",
    summarizeSite
  ));

  for (const host of tenantHostCandidates) {
    for (const personalPath of personalPathCandidates) {
      attempts.push(await tryRequest(
        `Personal site ${host}/${personalPath}`,
        `/sites/${host}:/${personalPath}:`,
        summarizeSite
      ));
    }
  }

  for (const attempt of attempts) printResult(attempt);

  const siteAttempts = attempts.filter((attempt) => attempt.ok && attempt.data?.id && attempt.label.includes("site"));
  for (const site of siteAttempts) {
    const drive = await tryRequest(
      `Drive for ${site.label}`,
      `/sites/${site.data.id}/drive`,
      summarizeDrive
    );
    printResult(drive);
    if (drive.ok && drive.data?.id) {
      console.log("");
      console.log("Use this in backend/.env:");
      console.log(`GRAPH_DRIVE_ID=${drive.data.id}`);
      return;
    }
  }

  const ownerDrive = attempts.find((attempt) => attempt.ok && attempt.label === "Owner user drive" && attempt.data?.id);
  if (ownerDrive) {
    console.log("");
    console.log("Use this in backend/.env:");
    console.log(`GRAPH_DRIVE_ID=${ownerDrive.data.id}`);
    return;
  }

  console.log("");
  console.log("No drive was discovered automatically.");
  console.log("If every route failed with authorization errors, confirm the app has admin-consented Microsoft Graph Application permission Files.ReadWrite.All.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
