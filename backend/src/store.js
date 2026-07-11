import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { nanoid } from "nanoid";

const __dirname = dirname(fileURLToPath(import.meta.url));
const defaultStorePath = resolve(__dirname, "../data/store.json");
const storePath = process.env.STORE_PATH || defaultStorePath;

const emptyStore = {
  users: [],
  models: [],
  shares: []
};

async function readStore() {
  try {
    return {
      ...emptyStore,
      ...JSON.parse(await readFile(storePath, "utf8"))
    };
  } catch (error) {
    if (error.code === "ENOENT") return structuredClone(emptyStore);
    throw error;
  }
}

async function writeStore(data) {
  await mkdir(dirname(storePath), { recursive: true });
  const tempPath = `${storePath}.${process.pid}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(data, null, 2)}\n`);
  await rename(tempPath, storePath);
}

export async function upsertUser(profile) {
  const store = await readStore();
  const existing = store.users.find((user) => user.microsoftId === profile.microsoftId || user.email === profile.email);
  const now = new Date().toISOString();

  if (existing) {
    Object.assign(existing, profile, { updatedAt: now });
    await writeStore(store);
    return existing;
  }

  const user = {
    id: nanoid(16),
    folderName: `user_${nanoid(10)}`,
    createdAt: now,
    updatedAt: now,
    ...profile
  };

  store.users.push(user);
  await writeStore(store);
  return user;
}

export async function getUserById(id) {
  const store = await readStore();
  return store.users.find((user) => user.id === id) || null;
}

export async function listModelsForUser(userId) {
  const store = await readStore();
  return store.models.filter((model) => model.ownerUserId === userId);
}

export async function listDemoModels() {
  const store = await readStore();
  return store.models.filter((model) => model.isDemo);
}

export async function upsertModel(model) {
  const store = await readStore();
  const now = new Date().toISOString();
  const id = model.id || nanoid(16);
  const existing = store.models.find((item) => item.id === id);

  if (existing) {
    Object.assign(existing, model, { id, updatedAt: now });
  } else {
    store.models.push({
      id,
      createdAt: now,
      updatedAt: now,
      ...model
    });
  }

  await writeStore(store);
  return store.models.find((item) => item.id === id);
}

export async function getModelsByIds(ids) {
  const wanted = new Set(ids);
  const store = await readStore();
  return store.models.filter((model) => wanted.has(model.id));
}

export async function createShare({ modelIds, ownerUserId, expiresAt = null }) {
  const store = await readStore();
  const share = {
    token: nanoid(32),
    modelIds,
    ownerUserId,
    expiresAt,
    createdAt: new Date().toISOString()
  };

  store.shares.push(share);
  await writeStore(store);
  return share;
}

export async function getShare(token) {
  const store = await readStore();
  const share = store.shares.find((item) => item.token === token);
  if (!share) return null;
  if (share.expiresAt && Date.parse(share.expiresAt) < Date.now()) return null;
  return share;
}
