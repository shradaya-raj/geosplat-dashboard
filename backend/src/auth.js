export function requireAuth(req, res, next) {
  if (req.session?.user) return next();
  return res.status(401).json({
    authenticated: false,
    error: "Sign-in is not connected yet. Supabase Auth will provide this session in the next phase."
  });
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
    mode: "supabase-r2"
  };
}
