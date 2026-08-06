import { Router } from "express";
import { config } from "./config.js";
import { sendApprovalEmail, sendProjectApprovalEmail } from "./email.js";
import { attachOptionalAuth, authPending, getSessionPayload, requireAuth } from "./auth.js";
import {
  buildModelKey,
  createPresignedDownload,
  createPresignedUpload,
  deleteObject,
  getExtension,
  getObjectInfo,
  isR2Configured
} from "./r2.js";
import { ASSET_TYPES, getAssetTypeLabel, normalizeAssetType } from "./asset-types.js";
import {
  createModelShare,
  createUploadingModel,
  deleteOwnedModel,
  deleteOwnedProject,
  deleteOwnedProjectAssets,
  getProjectAssetsForDelete,
  getOwnedPublishedModel,
  getProjectApprovalContext,
  getModelsForShare,
  getModelsOwnedByUser,
  listOwnedProjects,
  listOwnedUserModels,
  listPublishedDemoModels,
  markModelUploadComplete,
  recordModelAccess,
  resolveUploadProject,
  reviewModelByApprovalToken,
  reviewProjectModelsByToken
} from "./model-repository.js";

function frontendUrl(search = "") {
  const path = config.frontendAppPath.startsWith("/")
    ? config.frontendAppPath
    : `/${config.frontendAppPath}`;
  return `${config.frontendOrigin}${path}${search}`;
}

function backendUrl(path = "", req = null) {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const configured = config.backendBaseUrl;
  const shouldInfer = req && /^https?:\/\/localhost(?::\d+)?$/i.test(configured);
  if (!shouldInfer) return `${configured}${normalizedPath}`;

  const protocol = req.get("x-forwarded-proto") || req.protocol || "https";
  const host = req.get("x-forwarded-host") || req.get("host");
  return `${protocol}://${host}${normalizedPath}`;
}

function escapeHtml(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatBytes(bytes = 0) {
  const value = Number(bytes || 0);
  if (!Number.isFinite(value) || value <= 0) return "unknown";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = value;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size.toFixed(size >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function normalizeFormList(value) {
  if (!value) return [];
  return Array.isArray(value) ? value.filter(Boolean) : [value].filter(Boolean);
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
    projectId: model.projectId,
    projectName: model.projectName,
    projectSlug: model.projectSlug,
    assetType: model.assetType,
    assetTypeLabel: model.assetTypeLabel,
    ownerUserId: model.ownerUserId,
    ownerEmail: model.ownerEmail,
    status: model.status,
    canLoad: Boolean(model.path && model.status === "published"),
    isDemo: Boolean(model.isDemo),
    progressiveLoad: model.progressiveLoad ?? true,
    alphaThreshold: model.alphaThreshold ?? 0,
    position: model.position,
    rotation: model.rotation,
    scale: model.scale,
    sharedViewOnly: Boolean(model.sharedViewOnly)
  };
}

function publicProject(project) {
  const assets = Array.isArray(project.assets) ? project.assets : [];
  return {
    id: project.id,
    name: project.name,
    slug: project.slug,
    status: project.status,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    assetCounts: Object.fromEntries(
      Object.keys(ASSET_TYPES).map((assetType) => [
        assetType,
        assets.filter((asset) => asset.assetType === assetType).length
      ])
    ),
    assetsByType: Object.fromEntries(
      Object.entries(ASSET_TYPES).map(([assetType, definition]) => [
        assetType,
        {
          label: definition.label,
          files: assets
            .filter((asset) => asset.assetType === assetType)
            .map(publicModel)
        }
      ])
    )
  };
}

async function removeStoredObjects(models) {
  if (!isR2Configured()) return;
  for (const model of models) {
    if (!model?.r2Key) continue;
    await deleteObject(model.r2Key).catch((error) => {
      console.error(`R2 delete failed for ${model.r2Key}.`, error);
    });
  }
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
    if (model.status === "published" && model.r2Key && isR2Configured()) {
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
      service: "gaussian-viewer-backend"
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
        const userModels = await withSignedModelUrls(await listOwnedUserModels(req.user.id));
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

  router.get("/api/projects", requireAuth, async (req, res, next) => {
    try {
      const projects = await listOwnedProjects(req.session.user.id);
      const signedProjects = [];

      for (const project of projects) {
        signedProjects.push({
          ...project,
          assets: await withSignedModelUrls(project.assets || [])
        });
      }

      res.json({
        projects: signedProjects.map(publicProject),
        assetTypes: ASSET_TYPES
      });
    } catch (error) {
      next(error);
    }
  });

  router.post("/api/uploads/session", requireAuth, async (req, res, next) => {
    try {
      const filename = String(req.body?.filename || "");
      const size = Number(req.body?.size || 0);
      const contentType = String(req.body?.contentType || "application/octet-stream");
      const assetType = normalizeAssetType(String(req.body?.assetType || ""));
      const extension = getExtension(filename, assetType);

      if (!extension) return res.status(400).json({ error: `Unsupported ${getAssetTypeLabel(assetType)} file type.` });
      if (!Number.isFinite(size) || size <= 0) return res.status(400).json({ error: "File size is required." });
      if (size > config.maxUploadBytes) {
        return res.status(413).json({
          error: `File is larger than the configured upload limit of ${Math.round(config.maxUploadBytes / 1024 / 1024 / 1024)} GB.`
        });
      }

      if (!isR2Configured()) {
        return res.status(501).json({ error: "Cloud upload storage is not ready yet." });
      }

      const project = await resolveUploadProject({
        user: req.session.user,
        projectId: req.body?.projectId ? String(req.body.projectId) : null,
        projectName: String(req.body?.projectName || "")
      });
      const key = buildModelKey({
        userId: req.session.user.id,
        filename,
        projectId: project?.id,
        assetType,
        stage: "original"
      });
      const uploadUrl = await createPresignedUpload({ key, contentType });
      const model = await createUploadingModel({
        user: req.session.user,
        filename,
        size,
        r2Key: key,
        project,
        assetType
      });

      return res.json({
        provider: "r2",
        method: "PUT",
        uploadUrl,
        key,
        modelId: model.id,
        projectId: project?.id || null,
        assetType,
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
      if (!modelId || !r2Key) return res.status(400).json({ error: "Missing upload details." });

      const info = await getObjectInfo(r2Key);
      const record = await markModelUploadComplete({
        modelId,
        user: req.session.user,
        r2Key,
        objectInfo: info,
        name: req.body?.name,
        filename: req.body?.filename,
        uploadBatch: req.body?.uploadBatch || null
      });

      const uploadBatch = req.body?.uploadBatch || null;
      const isFinalBatchFile = uploadBatch
        && Number.isFinite(Number(uploadBatch.total))
        && Number.isFinite(Number(uploadBatch.index))
        && Number(uploadBatch.total) > 0
        && Number(uploadBatch.index) + 1 >= Number(uploadBatch.total);
      const projectApprovalToken = record.metadata?.projectApprovalToken;

      if (isFinalBatchFile && projectApprovalToken) {
        const context = await getProjectApprovalContext(projectApprovalToken);
        const pendingModels = context?.models || [];

        if (pendingModels.length) {
          const reviewUrl = backendUrl(`/api/admin/review-project?token=${encodeURIComponent(projectApprovalToken)}`, req);
          const approveAllUrl = backendUrl(`/api/admin/review-project/action?token=${encodeURIComponent(projectApprovalToken)}&decision=approve`, req);
          const rejectAllUrl = backendUrl(`/api/admin/review-project/action?token=${encodeURIComponent(projectApprovalToken)}&decision=reject`, req);

          sendProjectApprovalEmail({
            project: context.project,
            models: pendingModels,
            uploadedBy: req.session.user.email,
            reviewUrl,
            approveAllUrl,
            rejectAllUrl
          }).catch((error) => {
            console.error("Project approval email failed.", error);
          });
        }
      }

      const approvalToken = record.approvalToken;
      if (approvalToken && !uploadBatch) {
        const approveUrl = backendUrl(`/api/admin/review-model?token=${encodeURIComponent(approvalToken)}&decision=approve`, req);
        const rejectUrl = backendUrl(`/api/admin/review-model?token=${encodeURIComponent(approvalToken)}&decision=reject`, req);
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

  router.get("/api/admin/review-project", async (req, res, next) => {
    try {
      const token = typeof req.query.token === "string" ? req.query.token : "";
      if (!token) return res.status(400).send("Missing approval token.");

      const context = await getProjectApprovalContext(token);
      if (!context) return res.status(404).send("This project approval link is invalid or expired.");

      const safeProjectName = escapeHtml(context.project?.name || "Uploaded project");
      const rows = context.models.map((model) => `
        <tr>
          <td><input type="checkbox" name="modelIds" value="${escapeHtml(model.id)}" checked /></td>
          <td>
            <strong>${escapeHtml(model.name || model.filename || model.id)}</strong>
            <small>${escapeHtml(model.filename || "")}</small>
          </td>
          <td>${escapeHtml(model.assetTypeLabel || model.assetType || "File")}</td>
          <td>${escapeHtml(formatBytes(model.size))}</td>
          <td>
            <a class="mini approve" href="${backendUrl(`/api/admin/review-model?token=${encodeURIComponent(model.approvalToken)}&decision=approve`, req)}">Approve</a>
            <a class="mini reject" href="${backendUrl(`/api/admin/review-model?token=${encodeURIComponent(model.approvalToken)}&decision=reject`, req)}">Reject</a>
          </td>
        </tr>
      `).join("");

      const approveAllUrl = backendUrl(`/api/admin/review-project/action?token=${encodeURIComponent(token)}&decision=approve`, req);
      const rejectAllUrl = backendUrl(`/api/admin/review-project/action?token=${encodeURIComponent(token)}&decision=reject`, req);
      const dashboardUrl = frontendUrl("");

      res.type("html").send(`
        <!doctype html>
        <html>
          <head>
            <meta charset="utf-8" />
            <meta name="viewport" content="width=device-width, initial-scale=1" />
            <title>Review project upload</title>
            <style>
              body { font-family: Inter, Arial, sans-serif; background: #f3fbf4; color: #132019; margin: 0; padding: 28px; }
              main { max-width: 1040px; margin: 0 auto; padding: 28px; border-radius: 28px; background: rgba(255,255,255,.88); box-shadow: 0 24px 80px rgba(20, 60, 35, .14); }
              h1 { margin: 0 0 6px; font-size: clamp(28px, 5vw, 44px); letter-spacing: -.04em; }
              p { color: #647269; }
              table { width: 100%; border-collapse: collapse; margin: 22px 0; overflow: hidden; border-radius: 18px; }
              th, td { padding: 13px 12px; border-bottom: 1px solid #dde9e0; text-align: left; vertical-align: middle; }
              th { color: #526158; font-size: 12px; text-transform: uppercase; letter-spacing: .08em; }
              td small { display: block; color: #7a887f; margin-top: 4px; }
              input[type="checkbox"] { width: 18px; height: 18px; accent-color: #61d97e; }
              .actions { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }
              button, .button, .mini { border: 0; border-radius: 999px; padding: 11px 16px; font-weight: 800; text-decoration: none; cursor: pointer; }
              .approve, button[name="decision"][value="approve"] { background: #76e790; color: #102015; }
              .reject, button[name="decision"][value="reject"] { background: #ffe0db; color: #7a2115; }
              .button { background: #ecf2ee; color: #1a241e; }
              .mini { display: inline-block; padding: 8px 11px; font-size: 12px; margin-right: 5px; }
              .empty { padding: 24px; border-radius: 18px; background: #eef6ef; }
              @media (max-width: 760px) { body { padding: 10px; } main { padding: 18px; } table { font-size: 13px; } th:nth-child(3), td:nth-child(3), th:nth-child(4), td:nth-child(4) { display: none; } }
            </style>
          </head>
          <body>
            <main>
              <h1>Review project upload</h1>
              <p><strong>${safeProjectName}</strong> has ${context.models.length} pending file${context.models.length === 1 ? "" : "s"}. Select exactly what should be approved.</p>
              ${context.models.length ? `
                <form method="post" action="${backendUrl("/api/admin/review-project", req)}">
                  <input type="hidden" name="token" value="${escapeHtml(token)}" />
                  <table>
                    <thead>
                      <tr><th>Select</th><th>File</th><th>Type</th><th>Size</th><th>Quick action</th></tr>
                    </thead>
                    <tbody>${rows}</tbody>
                  </table>
                  <div class="actions">
                    <button type="submit" name="decision" value="approve">Approve selected</button>
                    <button type="submit" name="decision" value="reject">Reject selected</button>
                    <a class="button approve" href="${approveAllUrl}">Approve all</a>
                    <a class="button reject" href="${rejectAllUrl}">Reject all</a>
                    <a class="button" href="${dashboardUrl}">Open dashboard</a>
                  </div>
                </form>
              ` : `
                <div class="empty">No pending files remain for this project.</div>
                <p><a class="button" href="${dashboardUrl}">Open dashboard</a></p>
              `}
            </main>
          </body>
        </html>
      `);
    } catch (error) {
      next(error);
    }
  });

  router.post("/api/admin/review-project", async (req, res, next) => {
    try {
      const token = String(req.body?.token || "");
      const decision = req.body?.decision === "reject" ? "reject" : "approve";
      const modelIds = normalizeFormList(req.body?.modelIds);
      if (!token) return res.status(400).send("Missing approval token.");
      if (!modelIds.length) return res.redirect(303, `/api/admin/review-project?token=${encodeURIComponent(token)}`);

      const reviewed = await reviewProjectModelsByToken({ token, modelIds, decision });
      const statusLabel = decision === "reject" ? "rejected" : "published";
      res.type("html").send(`
        <!doctype html>
        <html>
          <head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>Files ${statusLabel}</title></head>
          <body style="font-family:Arial,sans-serif;background:#f4f8ef;color:#162019;display:grid;min-height:100vh;place-items:center;margin:0;">
            <main style="max-width:560px;padding:32px;border-radius:24px;background:white;box-shadow:0 20px 60px rgba(30,60,40,.14);">
              <h1>${reviewed.length} file${reviewed.length === 1 ? "" : "s"} ${statusLabel}</h1>
              <p>The selected project files were ${statusLabel}.</p>
              <p><a href="/api/admin/review-project?token=${encodeURIComponent(token)}" style="color:#087b4b;font-weight:700;">Review remaining files</a></p>
              <p><a href="${frontendUrl("")}" style="color:#087b4b;font-weight:700;">Open dashboard</a></p>
            </main>
          </body>
        </html>
      `);
    } catch (error) {
      next(error);
    }
  });

  router.get("/api/admin/review-project/action", async (req, res, next) => {
    try {
      const token = typeof req.query.token === "string" ? req.query.token : "";
      const decision = req.query.decision === "reject" ? "reject" : "approve";
      if (!token) return res.status(400).send("Missing approval token.");

      const reviewed = await reviewProjectModelsByToken({ token, modelIds: [], decision });
      const statusLabel = decision === "reject" ? "rejected" : "published";
      res.type("html").send(`
        <!doctype html>
        <html>
          <head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>Project ${statusLabel}</title></head>
          <body style="font-family:Arial,sans-serif;background:#f4f8ef;color:#162019;display:grid;min-height:100vh;place-items:center;margin:0;">
            <main style="max-width:560px;padding:32px;border-radius:24px;background:white;box-shadow:0 20px 60px rgba(30,60,40,.14);">
              <h1>Project files ${statusLabel}</h1>
              <p>${reviewed.length} pending file${reviewed.length === 1 ? "" : "s"} were ${statusLabel}.</p>
              <p><a href="${frontendUrl("")}" style="color:#087b4b;font-weight:700;">Open dashboard</a></p>
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

  router.delete("/api/models/:id", requireAuth, async (req, res, next) => {
    try {
      const model = await deleteOwnedModel({
        modelId: req.params.id,
        ownerId: req.session.user.id
      });

      if (!model) return res.status(404).json({ error: "File was not found for this owner." });
      await removeStoredObjects([model]);
      res.json({ ok: true, deleted: { modelId: model.id, r2Key: model.r2Key } });
    } catch (error) {
      next(error);
    }
  });

  router.delete("/api/projects/:id/types/:assetType", requireAuth, async (req, res, next) => {
    try {
      const assetType = normalizeAssetType(req.params.assetType);
      const models = await deleteOwnedProjectAssets({
        projectId: req.params.id,
        ownerId: req.session.user.id,
        assetType
      });

      await removeStoredObjects(models);
      res.json({
        ok: true,
        deleted: {
          projectId: req.params.id,
          assetType,
          fileCount: models.length
        }
      });
    } catch (error) {
      next(error);
    }
  });

  router.delete("/api/projects/:id", requireAuth, async (req, res, next) => {
    try {
      const models = await getProjectAssetsForDelete({
        projectId: req.params.id,
        ownerId: req.session.user.id
      });
      const project = await deleteOwnedProject({
        projectId: req.params.id,
        ownerId: req.session.user.id
      });

      if (!project) return res.status(404).json({ error: "Project was not found for this owner." });
      await removeStoredObjects(models);
      res.json({
        ok: true,
        deleted: {
          projectId: req.params.id,
          fileCount: models.length
        }
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
