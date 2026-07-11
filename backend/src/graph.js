import { config } from "./config.js";
import { getAppGraphToken } from "./auth.js";

const graphBase = "https://graph.microsoft.com/v1.0";

function encodePathSegment(value) {
  return encodeURIComponent(value).replace(/%2F/gi, "/");
}

async function graphFetch(path, options = {}) {
  const token = await getAppGraphToken();
  const response = await fetch(`${graphBase}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers
    }
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Graph request failed ${response.status}: ${body}`);
  }

  if (response.status === 204) return null;
  return response.json();
}

function driveRootPath() {
  if (!config.graph.driveId) {
    throw new Error("GRAPH_DRIVE_ID is required for owner OneDrive storage.");
  }
  return `/drives/${config.graph.driveId}`;
}

function itemByPath(path) {
  const cleanPath = path.split("/").filter(Boolean).map(encodeURIComponent).join("/");
  return `${driveRootPath()}/root:/${cleanPath}:`;
}

export function getUserOriginalFolderPath(user) {
  return `${config.graph.rootFolder}/users/${user.folderName}/uploads/original`;
}

export function getUserProcessedFolderPath(user) {
  return `${config.graph.rootFolder}/users/${user.folderName}/uploads/processed`;
}

export async function ensureFolderPath(path) {
  const segments = path.split("/").filter(Boolean);
  let currentPath = "";

  for (const segment of segments) {
    const parentPath = currentPath;
    currentPath = currentPath ? `${currentPath}/${segment}` : segment;

    try {
      await graphFetch(`${itemByPath(currentPath)}`);
    } catch {
      const childrenPath = parentPath
        ? `${itemByPath(parentPath)}:/children`
        : `${driveRootPath()}/root/children`;

      await graphFetch(childrenPath, {
        method: "POST",
        body: JSON.stringify({
          name: segment,
          folder: {},
          "@microsoft.graph.conflictBehavior": "fail"
        })
      });
    }
  }
}

export async function listFolderChildren(path) {
  await ensureFolderPath(path);
  const data = await graphFetch(`${itemByPath(path)}:/children`);
  return data.value || [];
}

export async function getDriveItem(itemId) {
  return graphFetch(`${driveRootPath()}/items/${itemId}`);
}

export async function createUploadSession({ folderPath, filename }) {
  await ensureFolderPath(folderPath);
  const safeFilename = filename.replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_");
  const uploadPath = `${folderPath}/${safeFilename}`;

  const session = await graphFetch(`${itemByPath(uploadPath)}:/createUploadSession`, {
    method: "POST",
    body: JSON.stringify({
      item: {
        "@microsoft.graph.conflictBehavior": "rename",
        name: safeFilename
      }
    })
  });

  return {
    uploadUrl: session.uploadUrl,
    expirationDateTime: session.expirationDateTime,
    folderPath,
    filename: safeFilename
  };
}

export async function createAnonymousViewLink(driveItemId) {
  const link = await graphFetch(`${driveRootPath()}/items/${driveItemId}/createLink`, {
    method: "POST",
    body: JSON.stringify({
      type: "view",
      scope: "anonymous",
      retainInheritedPermissions: false
    })
  });

  return link?.link?.webUrl || null;
}

export function mapDriveItemToModel(item, ownerUserId) {
  return {
    name: item.name,
    path: item["@microsoft.graph.downloadUrl"],
    filename: item.name,
    size: item.size,
    ownerUserId,
    driveItemId: item.id,
    updatedAt: item.lastModifiedDateTime
  };
}
