import { createClient } from "@supabase/supabase-js";
import { config } from "./config.js";

export function isSupabaseConfigured() {
  return Boolean(config.supabase.url && config.supabase.serviceRoleKey);
}

export function getSupabaseAdmin() {
  if (!isSupabaseConfigured()) {
    throw new Error("Supabase is not configured. Add SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.");
  }

  return createClient(config.supabase.url, config.supabase.serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  });
}

export async function listPublishedModelsForUser(userId) {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("models")
    .select("*")
    .eq("owner_id", userId)
    .eq("status", "published")
    .order("created_at", { ascending: false });

  if (error) throw error;
  return data || [];
}

export async function listModelsForUserFromSupabase(userId) {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("models")
    .select("*")
    .eq("owner_id", userId)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return data || [];
}

export async function listDemoModelsFromSupabase() {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("models")
    .select("*")
    .eq("is_demo", true)
    .eq("status", "published")
    .order("created_at", { ascending: false });

  if (error) throw error;
  return data || [];
}

export async function createModelRecord(record) {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("models")
    .insert(record)
    .select("*")
    .single();

  if (error) throw error;
  return data;
}

export async function updateModelRecord(id, patch, ownerId = null) {
  const supabase = getSupabaseAdmin();
  let query = supabase
    .from("models")
    .update(patch)
    .eq("id", id);

  if (ownerId) query = query.eq("owner_id", ownerId);

  const { data, error } = await query
    .select("*")
    .single();

  if (error) throw error;
  return data;
}

export async function getSupabaseModelsByIds(ids) {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("models")
    .select("*")
    .in("id", ids);

  if (error) throw error;
  return data || [];
}

export async function createProjectRecord(record) {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("projects")
    .insert(record)
    .select("*")
    .single();

  if (error) throw error;
  return data;
}

export async function getProjectForOwner(projectId, ownerId) {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("projects")
    .select("*")
    .eq("id", projectId)
    .eq("owner_id", ownerId)
    .maybeSingle();

  if (error) throw error;
  return data || null;
}

export async function listProjectsForUser(ownerId) {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("projects")
    .select("*, models(*)")
    .eq("owner_id", ownerId)
    .order("updated_at", { ascending: false });

  if (error) throw error;
  return data || [];
}

export async function listModelsForProject({ projectId, ownerId, assetType = null }) {
  const supabase = getSupabaseAdmin();
  let query = supabase
    .from("models")
    .select("*")
    .eq("project_id", projectId)
    .eq("owner_id", ownerId);

  if (assetType) query = query.eq("asset_type", assetType);

  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

export async function deleteModelRecord({ modelId, ownerId }) {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("models")
    .delete()
    .eq("id", modelId)
    .eq("owner_id", ownerId)
    .select("*")
    .maybeSingle();

  if (error) throw error;
  return data || null;
}

export async function deleteModelsForProject({ projectId, ownerId, assetType = null }) {
  const supabase = getSupabaseAdmin();
  let query = supabase
    .from("models")
    .delete()
    .eq("project_id", projectId)
    .eq("owner_id", ownerId);

  if (assetType) query = query.eq("asset_type", assetType);

  const { data, error } = await query.select("*");
  if (error) throw error;
  return data || [];
}

export async function deleteProjectRecord({ projectId, ownerId }) {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("projects")
    .delete()
    .eq("id", projectId)
    .eq("owner_id", ownerId)
    .select("*")
    .maybeSingle();

  if (error) throw error;
  return data || null;
}

export async function getSupabaseModelByApprovalToken(token) {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("models")
    .select("*")
    .eq("metadata->>approvalToken", token)
    .maybeSingle();

  if (error) throw error;
  return data || null;
}

export async function createSupabaseShare({ token, ownerId, modelIds, expiresAt = null }) {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("share_links")
    .insert({
      token,
      owner_id: ownerId,
      model_ids: modelIds,
      expires_at: expiresAt
    })
    .select("*")
    .single();

  if (error) throw error;
  return data;
}

export async function createAccessLog(record) {
  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from("access_logs")
    .insert(record);

  if (error) throw error;
}

export async function getSupabaseShare(token) {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("share_links")
    .select("*")
    .eq("token", token)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;
  if (data.expires_at && Date.parse(data.expires_at) < Date.now()) return null;
  return data;
}
