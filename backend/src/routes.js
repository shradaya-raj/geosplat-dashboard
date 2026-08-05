import { Router } from "express";
import { config } from "./config.js";
import { authPending, getSessionPayload, requireAuth } from "./auth.js";
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
  getModelsForShare,
  getModelsOwnedByUser,
  getRepositoryMode,
  listPublishedDemoModels,
  listPublishedUserModels,
  markModelUploadComplete
} from "./model-repository.js";

function frontendUrl(search = "") {
  const path = config.frontendAppPath.startsWith("/")
    ? config.frontendAppPath
    : `/${config.frontendAppPath}`;
  return `${config.frontendOrigin}${path}${search}`;
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
    scale: model.scale
  };
}

async function getModelsFromShare(token) {
  const models = await getModelsForShare(token);
  const visible = [];

  for (const model of models) {
    if (model.r2Key && isR2Configured()) {
      visible.push({
        ...model,
        path: await createPresignedDownload({ key: model.r2Key })
      });
      continue;
    }
    visible.push(model);
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

  router.get("/api/session", (req, res) => {
    res.json(getSessionPayload(req));
  });

  router.get("/api/models", async (req, res, next) => {
    try {
      const shareToken = typeof req.query.share === "string" ? req.query.share : "";
      if (shareToken) {
        const sharedModels = await getModelsFromShare(shareToken);
        return res.json({ models: sharedModels.map(publicModel), source: "share" });
      }

      if (req.session?.user) {
        const userModels = await withSignedModelUrls(await listPublishedUserModels(req.session.user.id));
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

      return res.json({
        ok: true,
        model: record,
        message: `Upload received. ${config.ownerEmail} should review/process it before publishing.`
      });
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

  return router;
}
