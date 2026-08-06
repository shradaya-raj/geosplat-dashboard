const viteEnv = import.meta.env || {};

export const APP_CONFIG = {
  apiBaseUrl: (viteEnv.VITE_GV_API_BASE_URL || "").replace(/\/$/, ""),
  supabaseUrl: viteEnv.VITE_SUPABASE_URL || "",
  supabaseAnonKey: viteEnv.VITE_SUPABASE_ANON_KEY || "",
  staticManifestUrl: `${viteEnv.BASE_URL || "/"}models/manifest.json`,
  ownerEmail: viteEnv.VITE_GV_OWNER_EMAIL || "shradaya.poudel@gallimaps.com",
  demoLabel: viteEnv.VITE_GV_DEMO_LABEL || "Demo model"
};

export function isBackendEnabled() {
  return Boolean(APP_CONFIG.apiBaseUrl);
}

export function isSupabaseAuthEnabled() {
  return Boolean(APP_CONFIG.supabaseUrl && APP_CONFIG.supabaseAnonKey);
}
