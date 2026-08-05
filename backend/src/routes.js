import { Router } from "express";
import { config } from "./config.js";
import { sendApprovalEmail } from "./email.js";
import { attachOptionalAuth, authPending, getSessionPayload, requireAuth } from "./auth.js";
import {
  buildModelKey,
  createPresignedDownload,
  createPresignedUpload,
  getExtension,
  getObjectInfo,
  isR2Configured
} from "./r2.js";
import {
  createModelShare,
  createUploadingModel,
  getOwnedPublishedModel,
  getModelsForShare,
  getModelsOwnedByUser,
  getRepositoryMode,
  listPublishedDemoModels,
  listPublishedUserModels,
  markModelUploadComplete,
  recordModelAccess,
  reviewModelByApprovalToken
} from "./model-repository.js";

function frontendUrl(search = "") {
  const path = config.frontendAppPath.startsWith("/")
    ? config.frontendAppPath
    : `/${config.frontendAppPath}`;
  return `${config.frontendOrigin}${path}${search}`;
}

function backendUrl(path = "") {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${config.backendBaseUrl}${normalizedPath}`;
}

function escapeHtml(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function extensionOf(filename = "") {
  return getExtension(filename);
}

function publicModel(model) {
  return {
    id: model.id,
    name: model.name,
    slug: model.slug,
    path: model.path,
    filename: model.filename,
    size: model.size,
    format: model.format,
    ownerUserId: model.ownerUserId,
    ownerEmail: model.ownerEmail,
    isDemo: Boolean(model.isDemo),
    progressiveLoad: model.progressiveLoad ?? true,
    alphaThreshold: model.alphaThreshold ?? 0,
    position: model.position,
    rotation: model.rotation,
    scale: model.scale,
    sharedViewOnly: Boolean(model.sharedViewOnly)
  };
}

function requestIp(req) {
  return req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.socket.remoteAddress || "";
}

function requestUserAgent(req) {
  return req.get("user-agent") || "";
}

async function getModelsFromShare(token, req) {
  const models = await getModelsForShare(token);
  const visible = [];

  for (const model of models) {
    if (model.r2Key && isR2Configured()) {
      visible.push({
        ...model,
        sharedViewOnly: true,
        path: await createPresignedDownload({
          key: model.r2Key,
          expiresIn: config.r2.sharedSignedUrlExpiresSeconds
        })
      });
      recordModelAccess({
        modelId: model.id,
        shareToken: token,
        action: "share_view",
        ip: requestIp(req),
        userAgent: requestUserAgent(req)
      }).catch((error) => console.error("Access log failed.", error));
      continue;
    }
    visible.push({ ...model, sharedViewOnly: true });
  }

  return visible.filter((model) => model.path || model.r2Key);
}

async function withSignedModelUrls(models) {
  const signed = [];

  for (const model of models) {
    if (model.r2Key && isR2Configured()) {
      signed.push({
        ...model,
        path: await createPresignedDownload({ key: model.r2Key })
      });
      continue;
    }
    signed.push(model);
  }

  return signed;
}

export function createRouter() {
  const router = Router();

  router.get("/health", (req, res) => {
    res.json({
      ok: true,
      service: "gaussian-viewer-backend",
      mode: getRepositoryMode(),
      r2Configured: isR2Configured()
    });
  });

  router.get("/api/auth/login", authPending);
  router.get("/api/auth/logout", authPending);

  router.get("/api/session", attachOptionalAuth, (req, res) => {
    res.json(getSessionPayload(req));
  });

  router.get("/api/models", attachOptionalAuth, async (req, res, next) => {
    try {
      const shareToken = typeof req.query.share === "string" ? req.query.share : "";
      if (shareToken) {
        const sharedModels = await getModelsFromShare(shareToken, req);
        return res.json({ models: sharedModels.map(publicModel), source: "share", sharedViewOnly: true });
      }

      if (req.user) {
        const userModels = await withSignedModelUrls(await listPublishedUserModels(req.user.id));
        if (userModels.length) {
          return res.json({ models: userModels.map(publicModel), source: "user" });
        }
      }

      const demoModels = await withSignedModelUrls(await listPublishedDemoModels());
      if (demoModels.length) {
        return res.json({ models: demoModels.map(publicModel), source: "demo" });
      }

      if (config.demoModelUrl) {
        return res.json({
          source: "demo",
          models: [
            {
              id: "demo",
              name: "Demo Gaussian model",
              slug: "demo",
              path: config.demoModelUrl,
              filename: config.demoModelUrl.split("/").pop(),
              isDemo: true,
              progressiveLoad: true
            }
          ]
        });
      }

      res.json({ models: [], source: "empty" });
    } catch (error) {
      next(error);
    }
  });

  router.post("/api/uploads/session", requireAuth, async (req, res, next) => {
    try {
      const filename = String(req.body?.filename || "");
      const size = Number(req.body?.size || 0);
      const contentType = String(req.body?.contentType || "application/octet-stream");
      const extension = extensionOf(filename);

      if (!extension) return res.status(400).json({ error: "Unsupported Gaussian model file type." });
      if (!Number.isFinite(size) || size <= 0) return res.status(400).json({ error: "File size is required." });
      if (size > config.maxUploadBytes) {
        return res.status(413).json({
          error: `File is larger than the configured upload limit of ${Math.round(config.maxUploadBytes / 1024 / 1024 / 1024)} GB.`
        });
      }

      if (!isR2Configured()) {
        return res.status(501).json({ error: "Cloudflare R2 storage is not configured." });
      }

      const key = buildModelKey({
        userId: req.session.user.id,
        filename,
        stage: "original"
      });
      const uploadUrl = await createPresignedUpload({ key, contentType });
      const model = await createUploadingModel({
        user: req.session.user,
        filename,
        size,
        r2Key: key
      });

      return res.json({
        provider: "r2",
        method: "PUT",
        uploadUrl,
        key,
        modelId: model.id,
        headers: {
          "Content-Type": contentType
        },
        expiresIn: Math.min(config.r2.signedUrlExpiresSeconds, 3600)
      });
    } catch (error) {
      next(error);
    }
  });

  router.post("/api/uploads/complete", requireAuth, async (req, res, next) => {
    try {
      const modelId = String(req.body?.modelId || "");
      const r2Key = String(req.body?.r2Key || req.body?.key || "");
      if (!modelId || !r2Key) return res.status(400).json({ error: "Missing R2 upload details." });

      const info = await getObjectInfo(r2Key);
      const record = await markModelUploadComplete({
        modelId,
        user: req.session.user,
        r2Key,
        objectInfo: info,
        name: req.body?.name,
        filename: req.body?.filename
      });

      const approvalToken = record.approvalToken;
      if (approvalToken) {
        const approveUrl = backendUrl(`/api/admin/review-model?token=${encodeURIComponent(approvalToken)}&decision=approve`);
        const rejectUrl = backendUrl(`/api/admin/review-model?token=${encodeURIComponent(approvalToken)}&decision=reject`);
        sendApprovalEmail({
          model: record,
          uploadedBy: req.session.user.email,
          approveUrl,
          rejectUrl
        }).catch((error) => {
          console.error("Approval email failed.", error);
        });
      }

      return res.json({
        ok: true,
        model: record,
        message: `Upload received. ${config.approvalEmail} should review/process it before publishing.`
      });
    } catch (error) {
      next(error);
    }
  });

  router.get("/api/admin/review-model", async (req, res, next) => {
    try {
      const token = typeof req.query.token === "string" ? req.query.token : "";
      const decision = req.query.decision === "reject" ? "reject" : "approve";
      if (!token) return res.status(400).send("Missing approval token.");

      const model = await reviewModelByApprovalToken({ token, decision });
      if (!model) {
        return res.status(404).send("This approval link is invalid, expired, or already used.");
      }

      const statusLabel = decision === "reject" ? "rejected" : "published";
      const openUrl = frontendUrl(`?model=${encodeURIComponent(model.slug || model.name || model.id)}`);
      const safeModelName = escapeHtml(model.name);
      res.type("html").send(`
        <!doctype html>
        <html>
          <head>
            <meta charset="utf-8" />
            <meta name="viewport" content="width=device-width, initial-scale=1" />
            <title>Model ${statusLabel}</title>
            <style>
              body { font-family: Arial, sans-serif; background: #f4f8ef; color: #162019; display: grid; min-height: 100vh; place-items: center; margin: 0; }
              main { max-width: 560px; padding: 32px; border-radius: 24px; background: white; box-shadow: 0 20px 60px rgba(30, 60, 40, .14); }
              a { color: #087b4b; font-weight: 700; }
            </style>
          </head>
          <body>
            <main>
              <h1>Model ${statusLabel}</h1>
              <p><strong>${safeModelName}</strong> has been ${statusLabel}.</p>
              ${decision === "reject" ? "" : `<p><a href="${openUrl}">Open the dashboard</a></p>`}
            </main>
          </body>
        </html>
      `);
    } catch (error) {
      next(error);
    }
  });

  router.post("/api/shares", requireAuth, async (req, res, next) => {
    try {
      const modelIds = Array.isArray(req.body?.modelIds) ? req.body.modelIds.filter(Boolean) : [];
      if (!modelIds.length) return res.status(400).json({ error: "Select a model first." });

      const models = await getModelsOwnedByUser(modelIds, req.session.user.id);
      const allowed = models.length === modelIds.length
        && models.every((model) => model.status === "published");

      if (!allowed) return res.status(403).json({ error: "You can only share your own published models." });

      const share = await createModelShare({ modelIds, ownerUserId: req.session.user.id });
      res.json({
        token: share.token,
        url: frontendUrl(`?share=${share.token}`)
      });
    } catch (error) {
      next(error);
    }
  });

  router.get("/api/models/:id/download-original", requireAuth, async (req, res, next) => {
    try {
      const model = await getOwnedPublishedModel(req.params.id, req.session.user.id);
      if (!model) return res.status(404).json({ error: "Published model was not found for this owner." });
      if (!model.r2Key || !isR2Configured()) return res.status(404).json({ error: "Model file is not available." });

      const downloadUrl = await createPresignedDownload({
        key: model.r2Key,
        expiresIn: Math.min(config.r2.signedUrlExpiresSeconds, 3600)
      });

      recordModelAccess({
        modelId: model.id,
        viewerId: req.session.user.id,
        action: "owner_download",
        ip: requestIp(req),
        userAgent: requestUserAgent(req)
      }).catch((error) => console.error("Access log failed.", error));

      res.json({
        url: downloadUrl,
        filename: model.filename,
        expiresIn: Math.min(config.r2.signedUrlExpiresSeconds, 3600)
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
