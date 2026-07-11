import crypto from "node:crypto";
import { ConfidentialClientApplication } from "@azure/msal-node";
import { config, getRedirectUri } from "./config.js";
import { upsertUser } from "./store.js";

const authority = `https://login.microsoftonline.com/${config.microsoft.tenantId}`;
const delegatedScopes = ["openid", "profile", "email", "User.Read"];
const graphScopes = ["https://graph.microsoft.com/.default"];

export const msalClient = new ConfidentialClientApplication({
  auth: {
    clientId: config.microsoft.clientId,
    clientSecret: config.microsoft.clientSecret,
    authority
  }
});

export function requireAuth(req, res, next) {
  if (req.session?.user) return next();
  return res.status(401).json({ authenticated: false });
}

export async function startLogin(req, res) {
  const state = crypto.randomBytes(16).toString("hex");
  req.session.authState = state;
  req.session.returnTo = typeof req.query.returnTo === "string"
    ? req.query.returnTo
    : config.frontendOrigin;

  const authUrl = await msalClient.getAuthCodeUrl({
    scopes: delegatedScopes,
    redirectUri: getRedirectUri(),
    state,
    prompt: "select_account"
  });

  res.redirect(authUrl);
}

export async function finishLogin(req, res, next) {
  try {
    if (!req.query.code || req.query.state !== req.session.authState) {
      return res.status(400).send("Invalid login callback.");
    }

    const result = await msalClient.acquireTokenByCode({
      code: req.query.code,
      scopes: delegatedScopes,
      redirectUri: getRedirectUri()
    });

    const account = result.account;
    const email = account?.username || account?.idTokenClaims?.preferred_username || account?.idTokenClaims?.email;
    const name = account?.name || account?.idTokenClaims?.name || email;

    const user = await upsertUser({
      microsoftId: account?.homeAccountId,
      email,
      name
    });

    req.session.user = {
      id: user.id,
      email: user.email,
      name: user.name,
      folderName: user.folderName
    };

    delete req.session.authState;
    const returnTo = req.session.returnTo || config.frontendOrigin;
    delete req.session.returnTo;
    res.redirect(returnTo);
  } catch (error) {
    next(error);
  }
}

export function logout(req, res) {
  const returnTo = typeof req.query.returnTo === "string"
    ? req.query.returnTo
    : config.frontendOrigin;

  req.session.destroy(() => {
    res.clearCookie("gv.sid");
    res.redirect(returnTo);
  });
}

export async function getAppGraphToken() {
  const result = await msalClient.acquireTokenByClientCredential({
    scopes: graphScopes
  });

  if (!result?.accessToken) throw new Error("Could not acquire Microsoft Graph app token.");
  return result.accessToken;
}
