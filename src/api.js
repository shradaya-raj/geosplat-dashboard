import { APP_CONFIG, isBackendEnabled } from "./config.js";
import { getAccessToken } from "./auth-client.js";

async function apiFetch(path, options = {}) {
  if (!isBackendEnabled()) return null;
  const accessToken = await getAccessToken();

  const response = await fetch(`${APP_CONFIG.apiBaseUrl}${path}`, {
    credentials: "include",
    cache: "no-store",
    ...options,
    headers: {
      Accept: "application/json",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...options.headers
    }
  });

  if (response.status === 401) {
    return { authenticated: false };
  }

  if (!response.ok) {
    throw new Error(`API request failed: ${response.status}`);
  }

  return response.json();
}

export async function getSession() {
  const session = await apiFetch("/api/session");
  return session || {
    authenticated: false,
    user: null,
    mode: "static"
  };
}

export async function getUserModels() {
  const shareToken = new URLSearchParams(window.location.search).get("share");
  const query = shareToken ? `?share=${encodeURIComponent(shareToken)}` : "";
  const payload = await apiFetch(`/api/models${query}`);
  if (!payload) return null;
  return Array.isArray(payload) ? { models: payload } : payload;
}

export async function getUserProjects() {
  const payload = await apiFetch("/api/projects");
  if (!payload) return null;
  return payload;
}

export async function createModelShare(modelIds) {
  const payload = await apiFetch("/api/shares", {
    method: "POST",
    body: JSON.stringify({ modelIds })
  });

  return payload?.url || null;
}

export async function getOwnerDownloadUrl(modelId) {
  return apiFetch(`/api/models/${encodeURIComponent(modelId)}/download-original`);
}

export async function createUploadSession(file, options = {}) {
  return apiFetch("/api/uploads/session", {
    method: "POST",
    body: JSON.stringify({
      filename: file.name,
      size: file.size,
      contentType: file.type || "application/octet-stream",
      projectId: options.projectId || null,
      projectName: options.projectName || "",
      assetType: options.assetType || "gaussian_splatting"
    })
  });
}

export async function completeUploadSession({ modelId, key, file }) {
  return apiFetch("/api/uploads/complete", {
    method: "POST",
    body: JSON.stringify({
      modelId,
      r2Key: key,
      name: file.name,
      filename: file.name
    })
  });
}

export function uploadFileToSignedUrl({ file, uploadUrl, headers = {}, onProgress }) {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("PUT", uploadUrl);

    for (const [name, value] of Object.entries(headers)) {
      request.setRequestHeader(name, value);
    }

    request.upload.onprogress = (event) => {
      if (!event.lengthComputable || !onProgress) return;
      onProgress(Math.round((event.loaded / event.total) * 100));
    };

    request.onload = () => {
      if (request.status >= 200 && request.status < 300) {
        resolve();
        return;
      }

      reject(new Error(`Upload failed with status ${request.status}`));
    };

    request.onerror = () => reject(new Error("Network error while uploading."));
    request.onabort = () => reject(new Error("Upload was cancelled."));
    request.send(file);
  });
}

export async function deleteHostedFile(modelId) {
  return apiFetch(`/api/models/${encodeURIComponent(modelId)}`, {
    method: "DELETE"
  });
}

export async function deleteHostedProject(projectId) {
  return apiFetch(`/api/projects/${encodeURIComponent(projectId)}`, {
    method: "DELETE"
  });
}

export async function deleteHostedProjectType(projectId, assetType) {
  return apiFetch(`/api/projects/${encodeURIComponent(projectId)}/types/${encodeURIComponent(assetType)}`, {
    method: "DELETE"
  });
}

export function getLoginUrl() {
  if (!isBackendEnabled()) return null;
  return `${APP_CONFIG.apiBaseUrl}/api/auth/login?returnTo=${encodeURIComponent(window.location.href)}`;
}

export function getLogoutUrl() {
  if (!isBackendEnabled()) return null;
  return `${APP_CONFIG.apiBaseUrl}/api/auth/logout?returnTo=${encodeURIComponent(window.location.href)}`;
}
