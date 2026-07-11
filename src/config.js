export const APP_CONFIG = {
  apiBaseUrl: (import.meta.env.VITE_GV_API_BASE_URL || "").replace(/\/$/, ""),
  staticManifestUrl: `${import.meta.env.BASE_URL}models/manifest.json`,
  ownerEmail: import.meta.env.VITE_GV_OWNER_EMAIL || "shradaya.poudel@gallimaps.com",
  demoLabel: import.meta.env.VITE_GV_DEMO_LABEL || "Demo model"
};

export function isBackendEnabled() {
  return Boolean(APP_CONFIG.apiBaseUrl);
}
