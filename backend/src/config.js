import "dotenv/config";

function required(name, fallback = undefined) {
  const value = process.env[name] || fallback;
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export const config = {
  port: Number(process.env.PORT || 8787),
  nodeEnv: process.env.NODE_ENV || "development",
  frontendOrigin: required("FRONTEND_ORIGIN", "http://localhost:5173").replace(/\/$/, ""),
  frontendAppPath: process.env.FRONTEND_APP_PATH || "/",
  backendBaseUrl: required("BACKEND_BASE_URL", "http://localhost:8787").replace(/\/$/, ""),
  sessionSecret: required("SESSION_SECRET", "dev-only-change-me"),
  ownerEmail: required("OWNER_EMAIL", "shradaya.poudel@gallimaps.com"),
  demoModelUrl: process.env.DEMO_MODEL_URL || "",
  microsoft: {
    clientId: required("MS_CLIENT_ID", "missing-client-id"),
    clientSecret: required("MS_CLIENT_SECRET", "missing-client-secret"),
    tenantId: required("MS_TENANT_ID", "common"),
    redirectPath: process.env.MS_REDIRECT_PATH || "/api/auth/callback"
  },
  graph: {
    driveId: process.env.GRAPH_DRIVE_ID || "",
    rootFolder: process.env.GRAPH_ROOT_FOLDER || "GaussianViewer"
  },
  storage: {
    provider: process.env.STORAGE_PROVIDER || "local"
  },
  supabase: {
    url: process.env.SUPABASE_URL || "",
    anonKey: process.env.SUPABASE_ANON_KEY || "",
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || ""
  },
  r2: {
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID || "",
    accessKeyId: process.env.R2_ACCESS_KEY_ID || "",
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || "",
    bucket: process.env.R2_BUCKET || "gaussian-models",
    publicBaseUrl: (process.env.R2_PUBLIC_BASE_URL || "").replace(/\/$/, ""),
    signedUrlExpiresSeconds: Number(process.env.R2_SIGNED_URL_EXPIRES_SECONDS || 3600)
  }
};

export function getRedirectUri() {
  return `${config.backendBaseUrl}${config.microsoft.redirectPath}`;
}

export function isProduction() {
  return config.nodeEnv === "production";
}
