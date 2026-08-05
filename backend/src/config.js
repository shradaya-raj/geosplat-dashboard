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
  approvalEmail: process.env.APPROVAL_EMAIL || process.env.OWNER_EMAIL || "shradaya.poudel@gallimaps.com",
  demoModelUrl: process.env.DEMO_MODEL_URL || "",
  maxUploadBytes: Number(process.env.MAX_UPLOAD_BYTES || 100 * 1024 * 1024 * 1024),
  email: {
    resendApiKey: process.env.RESEND_API_KEY || "",
    from: process.env.EMAIL_FROM || "Gaussian Viewer <onboarding@resend.dev>"
  },
  storage: {
    provider: process.env.STORAGE_PROVIDER || "r2"
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
    signedUrlExpiresSeconds: Number(process.env.R2_SIGNED_URL_EXPIRES_SECONDS || 3600),
    sharedSignedUrlExpiresSeconds: Number(process.env.R2_SHARED_SIGNED_URL_EXPIRES_SECONDS || 600)
  }
};

export function isProduction() {
  return config.nodeEnv === "production";
}

export function validateConfig() {
  if (isProduction() && config.sessionSecret === "dev-only-change-me") {
    throw new Error("SESSION_SECRET must be changed before running in production.");
  }

  if (config.r2.signedUrlExpiresSeconds < 60 || config.r2.signedUrlExpiresSeconds > 86400) {
    throw new Error("R2_SIGNED_URL_EXPIRES_SECONDS must be between 60 and 86400 seconds.");
  }

  if (config.r2.sharedSignedUrlExpiresSeconds < 30 || config.r2.sharedSignedUrlExpiresSeconds > 3600) {
    throw new Error("R2_SHARED_SIGNED_URL_EXPIRES_SECONDS must be between 30 and 3600 seconds.");
  }

  if (!Number.isFinite(config.maxUploadBytes) || config.maxUploadBytes < 1) {
    throw new Error("MAX_UPLOAD_BYTES must be a positive number.");
  }
}
