import { config } from "./config.js";
import { ensureFolderPath, ensureJsonFile, listFolderChildren } from "./graph.js";

const now = new Date().toISOString();
const root = config.graph.rootFolder;

const folders = [
  root,
  `${root}/system`,
  `${root}/system/indexes`,
  `${root}/system/logs`,
  `${root}/demo`,
  `${root}/demo/original`,
  `${root}/demo/processed`,
  `${root}/users`,
  `${root}/users/_template`,
  `${root}/users/_template/uploads`,
  `${root}/users/_template/uploads/original`,
  `${root}/users/_template/uploads/processed`
];

const files = [
  {
    path: `${root}/system/database.json`,
    value: {
      name: "Gaussian Viewer OneDrive Database",
      version: 1,
      createdAt: now,
      updatedAt: now,
      rootFolder: root,
      layout: {
        users: `${root}/users/{userId}`,
        userProfile: `${root}/users/{userId}/profile.json`,
        userModels: `${root}/users/{userId}/models.json`,
        originalUploads: `${root}/users/{userId}/uploads/original`,
        processedModels: `${root}/users/{userId}/uploads/processed`,
        demoModels: `${root}/demo/processed`
      }
    }
  },
  {
    path: `${root}/system/indexes/users.json`,
    value: {
      version: 1,
      updatedAt: now,
      users: []
    }
  },
  {
    path: `${root}/system/indexes/models.json`,
    value: {
      version: 1,
      updatedAt: now,
      models: []
    }
  },
  {
    path: `${root}/system/indexes/shares.json`,
    value: {
      version: 1,
      updatedAt: now,
      shares: []
    }
  },
  {
    path: `${root}/system/settings.json`,
    value: {
      version: 1,
      updatedAt: now,
      ownerEmail: config.ownerEmail,
      requireApprovalBeforePublishing: true,
      supportedExtensions: [".ply", ".splat", ".ksplat", ".spz"],
      defaultUserQuotaBytes: null,
      notes: "OneDrive stores files and JSON metadata. Backend enforces permissions."
    }
  },
  {
    path: `${root}/demo/models.json`,
    value: {
      version: 1,
      updatedAt: now,
      models: []
    }
  },
  {
    path: `${root}/users/_template/profile.json`,
    value: {
      id: "_template",
      email: "",
      name: "",
      role: "user",
      createdAt: now,
      updatedAt: now
    }
  },
  {
    path: `${root}/users/_template/models.json`,
    value: {
      version: 1,
      updatedAt: now,
      models: []
    }
  }
];

async function main() {
  if (!config.graph.driveId) {
    throw new Error("GRAPH_DRIVE_ID is missing. Add it to backend/.env before initializing OneDrive.");
  }

  console.log(`Initializing OneDrive database in drive ${config.graph.driveId}`);
  console.log(`Root folder: ${root}`);

  for (const folder of folders) {
    await ensureFolderPath(folder);
    console.log(`folder ok: ${folder}`);
  }

  for (const file of files) {
    const result = await ensureJsonFile(file.path, file.value);
    console.log(`${result.created ? "created" : "exists"}: ${file.path}`);
  }

  const rootItems = await listFolderChildren(root);
  console.log("");
  console.log("OneDrive database is ready.");
  console.log(`Top-level entries in ${root}:`);
  for (const item of rootItems) {
    console.log(`- ${item.name}${item.folder ? "/" : ""}`);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
