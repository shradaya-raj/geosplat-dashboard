import { nanoid } from "nanoid";
import { config } from "./config.js";
import { getExtension } from "./r2.js";
import { DEFAULT_ASSET_TYPE, getAssetTypeLabel, isRenderableGaussianAsset, normalizeAssetType } from "./asset-types.js";
import {
  createProjectRecord,
  createModelRecord,
  createAccessLog,
  createSupabaseShare,
  deleteModelRecord,
  deleteModelsForProject,
  deleteProjectRecord,
  getProjectForOwner,
  getSupabaseModelByApprovalToken,
  getSupabaseModelsByIds,
  getSupabaseShare,
  isSupabaseConfigured,
  listModelsForProject,
  listDemoModelsFromSupabase,
  listProjectsForUser,
  listPublishedModelsForUser,
  updateModelRecord
} from "./supabase-admin.js";
import {
  createShare,
  getModelByApprovalToken,
  getModelsByIds,
  getShare,
  listDemoModels,
  listModelsForUser,
  upsertModel
} from "./store.js";

function useSupabase() {
  return isSupabaseConfigured();
}

function rowToModel(row) {
  if (!row) return null;

  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    projectId: row.project_id || null,
    projectName: row.projects?.name || row.metadata?.projectName || null,
    projectSlug: row.projects?.slug || row.metadata?.projectSlug || null,
    assetType: row.asset_type || DEFAULT_ASSET_TYPE,
    assetTypeLabel: getAssetTypeLabel(row.asset_type || DEFAULT_ASSET_TYPE),
    filename: row.filename,
    size: row.size_bytes,
    format: row.extension,
    ownerUserId: row.owner_id,
    ownerEmail: row.owner_email || row.metadata?.ownerEmail || "",
    r2Key: row.r2_key,
    path: row.public_url || row.metadata?.path || "",
    status: row.status,
    isDemo: Boolean(row.is_demo),
    progressiveLoad: row.progressive_load,
    alphaThreshold: row.alpha_threshold,
    position: row.position,
    rotation: row.rotation,
    scale: row.scale,
    metadata: row.metadata || {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    approvalToken: row.metadata?.approvalToken || null
  };
}

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function projectRowToProject(row) {
  if (!row) return null;

  const assets = Array.isArray(row?.models)
    ? row.models.map((model) => rowToModel({
      ...model,
      projects: { id: row.id, name: row.name, slug: row.slug }
    }))
    : [];

  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    ownerUserId: row.owner_id,
    status: row.status,
    metadata: row.metadata || {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    assets
  };
}

function shareRowToShare(row) {
  if (!row) return null;

  return {
    token: row.token,
    modelIds: row.model_ids,
    ownerUserId: row.owner_id,
    expiresAt: row.expires_at,
    createdAt: row.created_at
  };
}

export async function listPublishedUserModels(userId) {
  if (useSupabase()) {
    const rows = await listPublishedModelsForUser(userId);
    return rows.map(rowToModel).filter((model) => isRenderableGaussianAsset(model.assetType, model.format));
  }

  const models = await listModelsForUser(userId);
  return models.filter((model) => model.status === "published");
}

export async function listPublishedDemoModels() {
  if (useSupabase()) {
    const rows = await listDemoModelsFromSupabase();
    return rows.map(rowToModel).filter((model) => isRenderableGaussianAsset(model.assetType, model.format));
  }

  const models = await listDemoModels();
  return models.filter((model) => model.status === "published");
}

export async function resolveUploadProject({ user, projectId = null, projectName = "" }) {
  if (!useSupabase()) return null;

  if (projectId) {
    const project = await getProjectForOwner(projectId, user.id);
    if (!project) {
      const error = new Error("Project was not found for this user.");
      error.status = 404;
      throw error;
    }
    return projectRowToProject(project);
  }

  const resolvedName = String(projectName || "").trim() || "Untitled project";
  const slugBase = slugify(resolvedName) || "project";
  const row = await createProjectRecord({
    owner_id: user.id,
    name: resolvedName.slice(0, 140),
    slug: `${slugBase}-${nanoid(6)}`,
    status: "active",
    metadata: {
      createdByEmail: user.email,
      source: "dashboard-upload"
    }
  });

  return projectRowToProject(row);
}

export async function createUploadingModel({ user, filename, size, r2Key, project = null, assetType = DEFAULT_ASSET_TYPE }) {
  const resolvedAssetType = normalizeAssetType(assetType);
  const extension = getExtension(filename, resolvedAssetType);
  const progressiveLoad = resolvedAssetType === "gaussian_splatting" && extension !== ".ply";

  if (useSupabase()) {
    const row = await createModelRecord({
      owner_id: user.id,
      project_id: project?.id || null,
      asset_type: resolvedAssetType,
      name: filename,
      filename,
      extension,
      r2_key: r2Key,
      size_bytes: Number.isFinite(size) ? size : null,
      status: "uploading",
      progressive_load: progressiveLoad,
      metadata: {
        ownerEmail: user.email,
        projectName: project?.name || null,
        projectSlug: project?.slug || null,
        assetTypeLabel: getAssetTypeLabel(resolvedAssetType),
        source: "r2-original"
      }
    });

    return rowToModel(row);
  }

  return upsertModel({
    id: `local_${nanoid(14)}`,
    name: filename,
    filename,
    size,
    format: extension,
    assetType: resolvedAssetType,
    ownerUserId: user.id,
    ownerEmail: user.email,
    r2Key,
    status: "uploading",
    source: "r2-original",
    progressiveLoad
  });
}

export async function markModelUploadComplete({ modelId, user, r2Key, objectInfo, name, filename }) {
  const expectedPrefix = `users/${user.id}/`;
  if (!r2Key.startsWith(expectedPrefix)) {
    const error = new Error("Upload object is outside this user's storage folder.");
    error.status = 403;
    throw error;
  }

  const resolvedFilename = filename || objectInfo.key.split("/").pop();
  const approvalToken = nanoid(40);
  const [existingModel] = await getModelsOwnedByUser([modelId], user.id);

  if (!existingModel) {
    const error = new Error("Model upload session not found for this user.");
    error.status = 404;
    throw error;
  }

  if (existingModel.r2Key && existingModel.r2Key !== r2Key) {
    const error = new Error("Upload object does not match the original upload session.");
    error.status = 400;
    throw error;
  }

  const resolvedAssetType = normalizeAssetType(existingModel.assetType);
  const extension = getExtension(resolvedFilename || objectInfo.key, resolvedAssetType);
  const progressiveLoad = resolvedAssetType === "gaussian_splatting" && extension !== ".ply";

  if (useSupabase()) {
    const row = await updateModelRecord(modelId, {
      name: name || resolvedFilename,
      filename: resolvedFilename,
      extension,
      r2_key: r2Key,
      size_bytes: objectInfo.size,
      status: "pending",
      progressive_load: progressiveLoad,
      metadata: {
        ...(existingModel.metadata || {}),
        ownerEmail: user.email,
        projectName: existingModel.projectName,
        projectSlug: existingModel.projectSlug,
        assetTypeLabel: getAssetTypeLabel(resolvedAssetType),
        source: "r2-original",
        contentType: objectInfo.contentType,
        approvalToken,
        approvalRequestedAt: new Date().toISOString()
      }
    }, user.id);

    return rowToModel(row);
  }

  return upsertModel({
    id: modelId,
    name: name || resolvedFilename,
    filename: resolvedFilename,
    size: objectInfo.size,
    format: extension,
    assetType: resolvedAssetType,
    ownerUserId: user.id,
    ownerEmail: user.email,
    r2Key,
    status: "pending",
    source: "r2-original",
    progressiveLoad,
    approvalToken
  });
}

export async function listOwnedProjects(userId) {
  if (!useSupabase()) return [];
  return (await listProjectsForUser(userId)).map(projectRowToProject);
}

export async function getProjectAssetsForDelete({ projectId, ownerId, assetType = null }) {
  if (!useSupabase()) return [];
  return (await listModelsForProject({ projectId, ownerId, assetType })).map(rowToModel);
}

export async function deleteOwnedModel({ modelId, ownerId }) {
  if (!useSupabase()) {
    const error = new Error("Persistent deletes require Supabase storage.");
    error.status = 501;
    throw error;
  }

  const row = await deleteModelRecord({ modelId, ownerId });
  return rowToModel(row);
}

export async function deleteOwnedProjectAssets({ projectId, ownerId, assetType = null }) {
  if (!useSupabase()) {
    const error = new Error("Persistent deletes require Supabase storage.");
    error.status = 501;
    throw error;
  }

  const rows = await deleteModelsForProject({ projectId, ownerId, assetType });
  return rows.map(rowToModel);
}

export async function deleteOwnedProject({ projectId, ownerId }) {
  if (!useSupabase()) {
    const error = new Error("Persistent deletes require Supabase storage.");
    error.status = 501;
    throw error;
  }

  const row = await deleteProjectRecord({ projectId, ownerId });
  return row ? projectRowToProject(row) : null;
}

export async function reviewModelByApprovalToken({ token, decision }) {
  const nextStatus = decision === "reject" ? "rejected" : "published";

  if (useSupabase()) {
    const row = await getSupabaseModelByApprovalToken(token);
    if (!row || !["pending", "processing"].includes(row.status)) return null;

    const metadata = {
      ...(row.metadata || {}),
      approvalToken: null,
      reviewedAt: new Date().toISOString(),
      reviewDecision: nextStatus
    };

    const updated = await updateModelRecord(row.id, {
      status: nextStatus,
      metadata
    });

    return rowToModel(updated);
  }

  const model = await getModelByApprovalToken(token);
  if (!model || !["pending", "processing"].includes(model.status)) return null;

  return upsertModel({
    ...model,
    status: nextStatus,
    approvalToken: null,
    reviewedAt: new Date().toISOString(),
    reviewDecision: nextStatus
  });
}

export async function getModelsForShare(token) {
  const share = useSupabase()
    ? shareRowToShare(await getSupabaseShare(token))
    : await getShare(token);

  if (!share) return [];

  const models = useSupabase()
    ? (await getSupabaseModelsByIds(share.modelIds)).map(rowToModel)
    : await getModelsByIds(share.modelIds);

  return models.filter((model) => model.status === "published");
}

export async function getModelsOwnedByUser(modelIds, userId) {
  const models = useSupabase()
    ? (await getSupabaseModelsByIds(modelIds)).map(rowToModel)
    : await getModelsByIds(modelIds);

  return models.filter((model) => model.ownerUserId === userId);
}

export async function getOwnedPublishedModel(modelId, userId) {
  const [model] = await getModelsOwnedByUser([modelId], userId);
  if (!model || model.status !== "published") return null;
  return model;
}

export async function recordModelAccess({ modelId, viewerId = null, shareToken = null, action, ip, userAgent }) {
  if (!useSupabase()) return;

  await createAccessLog({
    model_id: modelId,
    viewer_id: viewerId,
    share_token: shareToken,
    action,
    ip,
    user_agent: userAgent
  });
}

export async function createModelShare({ modelIds, ownerUserId }) {
  if (useSupabase()) {
    const token = nanoid(32);
    const row = await createSupabaseShare({
      token,
      ownerId: ownerUserId,
      modelIds
    });
    return shareRowToShare(row);
  }

  return createShare({ modelIds, ownerUserId });
}

export function getRepositoryMode() {
  return {
    database: useSupabase() ? "supabase" : "local-json",
    storage: config.storage.provider
  };
}
