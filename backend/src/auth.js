import { getSupabaseAdmin, isSupabaseConfigured } from "./supabase-admin.js";

function getBearerToken(req) {
  const header = req.get("authorization") || "";
  const [scheme, token] = header.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token) return "";
  return token;
}

async function getSupabaseUserFromRequest(req) {
  const token = getBearerToken(req);
  if (!token || !isSupabaseConfigured()) return null;

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) return null;

  return {
    id: data.user.id,
    email: data.user.email,
    fullName: data.user.user_metadata?.full_name || data.user.user_metadata?.name || data.user.email
  };
}

export async function attachOptionalAuth(req, res, next) {
  try {
    if (req.session?.user) {
      req.user = req.session.user;
      return next();
    }

    const user = await getSupabaseUserFromRequest(req);
    if (user) {
      req.user = user;
      req.session.user = user;
    }

    return next();
  } catch (error) {
    return next(error);
  }
}

export async function requireAuth(req, res, next) {
  try {
    if (req.session?.user) return next();

    const user = await getSupabaseUserFromRequest(req);
    if (user) {
      req.user = user;
      req.session.user = user;
      return next();
    }

    return res.status(401).json({
      authenticated: false,
      error: "Sign in is required."
    });
  } catch (error) {
    return next(error);
  }
}

export function authPending(req, res) {
  res.status(501).json({
    error: "Authentication setup pending.",
    next: "Connect Supabase Auth, then this route will redirect to the login flow."
  });
}

export function getSessionPayload(req) {
  return {
    authenticated: Boolean(req.session?.user),
    user: req.session?.user || null,
    mode: isSupabaseConfigured() ? "supabase-r2" : "local-development"
  };
}
