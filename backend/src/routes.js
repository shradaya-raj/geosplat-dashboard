import { Router } from "express";
import { nanoid } from "nanoid";
import { config } from "./config.js";
import { finishLogin, logout, requireAuth, startLogin } from "./auth.js";
import {
  createUploadSession,
  getDriveItem,
  getUserOriginalFolderPath,
  getUserProcessedFolderPath,
  listFolderChildren,
  mapDriveItemToModel
} from "./graph.js";
import {
  createShare,
  getModelsByIds,
  getShare,
  listDemoModels,
  listModelsForUser,
  upsertModel
} from "./store.js";

const supportedExtensions = new Set([".ply", ".splat", ".ksplat", ".spz"]);

function frontendUrl(search = "") {
  const path = config.frontendAppPath.startsWith("/")
    ? config.frontendAppPath
    : `/${config.frontendAppPath}`;
  return `${config.frontendOrigin}${path}${search}`;
}

function extensionOf(filename = "") {
  const lower = filename.split("?")[0].split("#")[0].toLowerCase();
  return [...supportedExtensions].find((extension) => lower.endsWith(extension));
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

async function getPublishedModelsForUser(user) {
  const stored = await listModelsForUser(user.id);
  const published = stored.filter((model) => model.status === "published" && model.path);

  if (config.graph.driveId) {
    try {
      const children = await listFolderChildren(getUserProcessedFolderPath(user));
      for (const item of children) {
        if (!item.file || !extensionOf(item.name)) continue;
        const mapped = mapDriveItemToModel(item, user.id);
        await upsertModel({
          ...mapped,
          id: `drive_${item.id}`,
          ownerEmail: user.email,
          status: "published",
          progressiveLoad: extensionOf(item.name) !== ".ply"
        });
      }
    } catch (error) {
      console.warn("Could not scan processed OneDrive folder.", error.message);
    }
  }

  const refreshed = await listModelsForUser(user.id);
  return refreshed.filter((model) => model.status === "published" && model.path);
}

async function getModelsFromShare(token) {
  const share = await getShare(token);
  if (!share) return [];
  const models = await getModelsByIds(share.modelIds);
  const visible = [];

  for (const model of models) {
    if (model.driveItemId && config.graph.driveId) {
      try {
        const item = await getDriveItem(model.driveItemId);
        visible.push({
          ...model,
          path: item["@microsoft.graph.downloadUrl"] || model.path,
          size: item.size || model.size
        });
        continue;
      } catch (error) {
        console.warn("Could not refresh shared model download URL.", error.message);
      }
    }
    visible.push(model);
  }

  return visible.filter((model) => model.status === "published" && model.path);
}

export function createRouter() {
  const router = Router();

  router.get("/health", (req, res) => {
    res.json({ ok: true, service: "gaussian-viewer-backend" });
  });

  router.get("/api/auth/login", startLogin);
  router.get(config.microsoft.redirectPath, finishLogin);
  router.get("/api/auth/logout", logout);

  router.get("/api/session", (req, res) => {
    res.json({
      authenticated: Boolean(req.session?.user),
      user: req.session?.user || null,
      mode: config.graph.driveId ? "onedrive-owner-storage" : "metadata-only"
    });
  });

  router.get("/api/models", async (req, res, next) => {
    try {
      const shareToken = typeof req.query.share === "string" ? req.query.share : "";
      if (shareToken) {
        const sharedModels = await getModelsFromShare(shareToken);
        return res.json({ models: sharedModels.map(publicModel), source: "share" });
      }

      if (req.session?.user) {
        const userModels = await getPublishedModelsForUser(req.session.user);
        if (userModels.length) {
          return res.json({ models: userModels.map(publicModel), source: "user" });
        }
      }

      const demoModels = await listDemoModels();
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
      const extension = extensionOf(filename);

      if (!extension) return res.status(400).json({ error: "Unsupported Gaussian model file type." });
      if (!config.graph.driveId) return res.status(501).json({ error: "OneDrive storage is not configured." });

      const session = await createUploadSession({
        folderPath: getUserOriginalFolderPath(req.session.user),
        filename
      });

      await upsertModel({
        id: `upload_${nanoid(14)}`,
        name: filename,
        filename,
        size,
        ownerUserId: req.session.user.id,
        ownerEmail: req.session.user.email,
        status: "uploading",
        source: "onedrive-original"
      });

      res.json(session);
    } catch (error) {
      next(error);
    }
  });

  router.post("/api/uploads/complete", requireAuth, async (req, res, next) => {
    try {
      const item = req.body?.driveItem;
      if (!item?.id || !item?.name) return res.status(400).json({ error: "Missing uploaded drive item." });
      if (!extensionOf(item.name)) return res.status(400).json({ error: "Unsupported Gaussian model file type." });

      const record = await upsertModel({
        id: `drive_${item.id}`,
        name: item.name,
        filename: item.name,
        size: item.size,
        ownerUserId: req.session.user.id,
        ownerEmail: req.session.user.email,
        driveItemId: item.id,
        status: "pending",
        source: "onedrive-original",
        progressiveLoad: extensionOf(item.name) !== ".ply"
      });

      res.json({
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

      const models = await getModelsByIds(modelIds);
      const allowed = models.length === modelIds.length
        && models.every((model) => model.ownerUserId === req.session.user.id && model.status === "published");

      if (!allowed) return res.status(403).json({ error: "You can only share your own published models." });

      const share = await createShare({ modelIds, ownerUserId: req.session.user.id });
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
