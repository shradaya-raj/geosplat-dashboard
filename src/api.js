import { APP_CONFIG, isBackendEnabled } from "./config.js";

async function apiFetch(path, options = {}) {
  if (!isBackendEnabled()) return null;

  const response = await fetch(`${APP_CONFIG.apiBaseUrl}${path}`, {
    credentials: "include",
    cache: "no-store",
    ...options,
    headers: {
      Accept: "application/json",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
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

export async function createModelShare(modelIds) {
  const payload = await apiFetch("/api/shares", {
    method: "POST",
    body: JSON.stringify({ modelIds })
  });

  return payload?.url || null;
}

export function getLoginUrl() {
  if (!isBackendEnabled()) return null;
  return `${APP_CONFIG.apiBaseUrl}/api/auth/login?returnTo=${encodeURIComponent(window.location.href)}`;
}

export function getLogoutUrl() {
  if (!isBackendEnabled()) return null;
  return `${APP_CONFIG.apiBaseUrl}/api/auth/logout?returnTo=${encodeURIComponent(window.location.href)}`;
}
