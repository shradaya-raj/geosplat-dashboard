import {
  completeUploadSession,
  createModelShare,
  createUploadSession,
  getLoginUrl,
  getLogoutUrl,
  getOwnerDownloadUrl,
  getSession,
  getUserModels,
  uploadFileToSignedUrl
} from "./api.js";
import {
  getBrowserSession,
  signInWithEmail,
  signInWithPassword,
  signOut,
  signUpWithPassword
} from "./auth-client.js";
import { APP_CONFIG, isBackendEnabled, isSupabaseAuthEnabled } from "./config.js";
import "./style.css";

const SUPPORTED_EXTENSIONS = [".ply", ".splat", ".ksplat", ".spz"];
const MAX_LOCAL_PREVIEW_BYTES = 350 * 1024 * 1024;
const MAX_LOCAL_PLY_PREVIEW_BYTES = 150 * 1024 * 1024;
const LARGE_HOSTED_MODEL_BYTES = 125 * 1024 * 1024;
const STALLED_LOAD_WARNING_MS = 45000;
const MODEL_REFRESH_INTERVAL_MS = 12000;
let GaussianSplats3D;
let THREE;
let sceneFormatByExtension = {};

const connectionLabel = document.querySelector("#connection-label");
const loadingPanel = document.querySelector("#loading-panel");
const loadingTitle = document.querySelector("#loading-title");
const loadingDetail = document.querySelector("#loading-detail");
const modelLoadProgress = document.querySelector("#model-load-progress");
const emptyPanel = document.querySelector("#empty-panel");
const readyPanel = document.querySelector("#ready-panel");
const viewerElement = document.querySelector("#viewer");
const modelSelect = document.querySelector("#model-select");
const loadSelectedButton = document.querySelector("#load-selected");
const reloadButton = document.querySelector("#reload-model");
const frameButton = document.querySelector("#frame-model");
const pointModeButton = document.querySelector("#point-mode");
const downloadOriginalButton = document.querySelector("#download-original");
const localModelButton = document.querySelector("#local-model");
const fileInput = document.querySelector("#file-input");
const shareButton = document.querySelector("#share-button");
const themeToggle = document.querySelector("#theme-toggle");
const uploadHelpButton = document.querySelector("#upload-help-button");
const uploadPanel = document.querySelector("#upload-panel");
const closeUploadPanel = document.querySelector("#close-upload-panel");
const cloudUploadInput = document.querySelector("#cloud-upload-input");
const cloudUploadButton = document.querySelector("#cloud-upload-button");
const uploadProgress = document.querySelector("#upload-progress");
const uploadFileName = document.querySelector("#upload-file-name");
const uploadProgressBar = document.querySelector("#upload-progress-bar");
const uploadProgressLabel = document.querySelector("#upload-progress-label");
const toast = document.querySelector("#toast");
const dropZone = document.querySelector("#drop-zone");
const modelInfo = document.querySelector("#model-info");
const accountStatus = document.querySelector("#account-status");
const accountHint = document.querySelector("#account-hint");
const accountAction = document.querySelector("#account-action");

let viewer;
let models = [];
let currentSession = { authenticated: false, user: null, mode: "static" };
let activeModel = null;
let activeModels = [];
let activeObjectUrl = null;
let lastFrame = null;
let pointModeEnabled = false;
let activeLoadToken = 0;
let loadingWatchdog = null;
let selectedCloudUploadFile = null;
let currentModelSource = "static";
let modelRefreshTimer = null;

async function loadViewerLibraries() {
  if (GaussianSplats3D && THREE) return;

  [GaussianSplats3D, THREE] = await Promise.all([
    import("@mkkellogg/gaussian-splats-3d"),
    import("three")
  ]);

  sceneFormatByExtension = {
    ".ply": GaussianSplats3D.SceneFormat.Ply,
    ".splat": GaussianSplats3D.SceneFormat.Splat,
    ".ksplat": GaussianSplats3D.SceneFormat.KSplat,
    ".spz": GaussianSplats3D.SceneFormat.Spz
  };
}

function applyTheme(theme) {
  const normalizedTheme = theme === "dark" ? "dark" : "light";
  document.documentElement.dataset.theme = normalizedTheme;
  window.localStorage.setItem("gaussian-viewer-theme", normalizedTheme);
  if (themeToggle) {
    themeToggle.textContent = normalizedTheme === "dark" ? "Light theme" : "Dark theme";
  }
}

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function updateShareUrl(selectedModels) {
  if (selectedModels && !Array.isArray(selectedModels)) selectedModels = [selectedModels];
  if (!selectedModels?.length || activeObjectUrl) return;

  const url = new URL(window.location.href);
  if (url.searchParams.has("share")) return;
  url.searchParams.delete("model");
  url.searchParams.delete("models");

  if (selectedModels.length === 1) {
    url.searchParams.set("model", selectedModels[0].slug || slugify(selectedModels[0].name));
  } else {
    url.searchParams.set(
      "models",
      selectedModels.map((model) => model.slug || slugify(model.name)).join(",")
    );
  }

  window.history.replaceState({}, "", url);
}

function getShareUrl() {
  if (activeObjectUrl) return null;
  return window.location.href;
}

function setStatus(label, detail, state = "loading") {
  connectionLabel.textContent = label;
  loadingTitle.textContent = label;
  loadingDetail.textContent = detail;
  document.documentElement.dataset.state = state;
}

function setModelLoadProgress(percent) {
  if (!modelLoadProgress) return;

  if (!Number.isFinite(percent)) {
    modelLoadProgress.hidden = true;
    modelLoadProgress.value = 0;
    return;
  }

  modelLoadProgress.hidden = false;
  modelLoadProgress.value = Math.max(0, Math.min(100, Math.round(percent)));
}

function clearLoadingWatchdog() {
  if (!loadingWatchdog) return;
  window.clearInterval(loadingWatchdog);
  loadingWatchdog = null;
}

function startLoadingWatchdog(model, token) {
  clearLoadingWatchdog();
  const startedAt = Date.now();
  let lastProgressAt = startedAt;
  let lastProgressText = "";

  loadingWatchdog = window.setInterval(() => {
    if (token !== activeLoadToken) {
      clearLoadingWatchdog();
      return;
    }

    const elapsedSeconds = Math.round((Date.now() - startedAt) / 1000);
    const stalledSeconds = Math.round((Date.now() - lastProgressAt) / 1000);

    if (Date.now() - lastProgressAt > STALLED_LOAD_WARNING_MS) {
      const sizeHint = model.size ? ` (${formatBytes(model.size)})` : "";
      setStatus(
        "Still loading",
        `${model.name}${sizeHint} • ${elapsedSeconds}s elapsed. If this stays here, use a smaller sampled or tiled model.`,
        "loading"
      );
      return;
    }

    if (lastProgressText) {
      setStatus("Loading model", `${lastProgressText} • ${stalledSeconds}s since update`, "loading");
    }
  }, 5000);

  return (progressText) => {
    lastProgressAt = Date.now();
    lastProgressText = progressText;
  };
}

function getModelDisplayName(selectedModels) {
  if (!selectedModels?.length) return "No model";
  if (selectedModels.length === 1) return selectedModels[0].name;
  return `${selectedModels.length} blocks`;
}

function getTotalModelSize(selectedModels) {
  const total = selectedModels
    .map((model) => model.size)
    .filter(Number.isFinite)
    .reduce((sum, size) => sum + size, 0);

  return total || undefined;
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("show");
  window.setTimeout(() => toast.classList.remove("show"), 2400);
}

function updateAccountUI(session = currentSession) {
  if (!accountStatus || !accountHint || !accountAction) return;

  if (!isBackendEnabled()) {
    accountStatus.textContent = "Static viewer mode";
    accountHint.textContent = "Private sign-in needs the backend/domain API. Public demo/hosted models are shown for now.";
    accountAction.hidden = false;
    accountAction.href = "#backend-setup";
    accountAction.textContent = "Backend setup pending";
    accountAction.setAttribute("aria-disabled", "true");
    return;
  }

  if (session.authenticated) {
    const email = session.user?.email || session.user?.name || "Signed in user";
    accountStatus.textContent = email;
    accountHint.textContent = "Only models assigned to this account will appear below.";
    accountAction.hidden = false;
    accountAction.href = getLogoutUrl() || "#";
    accountAction.textContent = "Sign out";
    accountAction.dataset.action = "sign-out";
    accountAction.removeAttribute("aria-disabled");
    return;
  }

  accountStatus.textContent = "Not signed in";
  accountHint.textContent = isSupabaseAuthEnabled()
    ? "Sign in with email to view your private model workspace."
    : "Add Supabase URL and anon key to enable real sign in.";
  const loginUrl = getLoginUrl();
  accountAction.hidden = false;
  accountAction.href = loginUrl || "#";
  accountAction.textContent = "Sign in";
  accountAction.dataset.action = "sign-in";
  if (isSupabaseAuthEnabled()) {
    accountAction.removeAttribute("aria-disabled");
  } else {
    accountAction.setAttribute("aria-disabled", "true");
  }
}

function showUploadPanel() {
  uploadPanel.hidden = false;
  refreshUploadControls();
}

function hideUploadPanel() {
  uploadPanel.hidden = true;
}

function isSupportedModelFile(file) {
  if (!file?.name) return false;
  const lowerName = file.name.toLowerCase();
  return SUPPORTED_EXTENSIONS.some((extension) => lowerName.endsWith(extension));
}

function setUploadProgress(label, percent = 0) {
  if (!uploadProgress || !uploadProgressBar || !uploadProgressLabel) return;

  uploadProgress.hidden = false;
  uploadProgressBar.value = Math.max(0, Math.min(100, percent));
  uploadProgressLabel.textContent = label;
}

function refreshUploadControls() {
  if (!cloudUploadButton) return;

  const canUpload = Boolean(
    isBackendEnabled()
    && currentSession.authenticated
    && selectedCloudUploadFile
  );

  cloudUploadButton.disabled = !canUpload;

  if (uploadFileName) {
    uploadFileName.textContent = selectedCloudUploadFile
      ? `${selectedCloudUploadFile.name} (${formatBytes(selectedCloudUploadFile.size)})`
      : "No file selected";
  }
}

async function promptForPasswordAuth(mode) {
  const email = window.prompt(`Enter email for ${mode}:`);
  if (!email) return false;

  const password = window.prompt("Enter password, minimum 6 characters:");
  if (!password) return false;

  if (mode === "sign up") {
    await signUpWithPassword(email.trim(), password);
    showToast("Account created. If email confirmation is enabled, check your inbox once.");
  } else {
    await signInWithPassword(email.trim(), password);
    showToast("Signed in");
  }

  await refreshSession();
  models = await loadManifest();
  fillModelSelect();
  return true;
}

async function promptForMagicLink() {
  const email = window.prompt("Enter your email for a secure sign-in link:");
  if (!email) return false;

  await signInWithEmail(email.trim());
  showToast("Check your email for the sign-in link.");
  return true;
}

async function refreshSession() {
  const browserSession = await getBrowserSession().catch((error) => {
    console.warn("Supabase browser session unavailable.", error);
    return null;
  });

  if (browserSession) {
    currentSession = browserSession;
    updateAccountUI(currentSession);
    refreshUploadControls();
    refreshDownloadButton();
    return currentSession;
  }

  currentSession = await getSession().catch((error) => {
    console.warn("Session API unavailable; using static viewer mode.", error);
    return { authenticated: false, user: null, mode: "static" };
  });
  updateAccountUI(currentSession);
  refreshUploadControls();
  refreshDownloadButton();
  return currentSession;
}

function showLoading(title, detail) {
  loadingPanel.hidden = false;
  loadingPanel.classList.remove("is-error", "is-complete");
  setModelLoadProgress(null);
  setStatus(title, detail);
}

function hideLoading() {
  clearLoadingWatchdog();
  setModelLoadProgress(null);
  loadingPanel.classList.add("is-complete");
  window.setTimeout(() => {
    loadingPanel.hidden = true;
  }, 300);
}

function showEmptyState() {
  readyPanel.hidden = true;
  emptyPanel.hidden = false;
  hideLoading();
  setStatus("Ready for files", "Add hosted models or open a local splat.", "ready");
}

function hideEmptyState() {
  emptyPanel.hidden = true;
}

function showReadyState() {
  emptyPanel.hidden = true;
  readyPanel.hidden = false;
  hideLoading();
  setStatus("Choose model", "Hosted models are available.", "ready");
}

function hideReadyState() {
  readyPanel.hidden = true;
}

function cleanObjectUrl() {
  if (!activeObjectUrl) return;
  URL.revokeObjectURL(activeObjectUrl);
  activeObjectUrl = null;
}

function resetViewer() {
  if (!GaussianSplats3D) {
    throw new Error("3D viewer library is not loaded yet.");
  }

  if (viewer) {
    viewer.dispose();
    viewer = null;
  }

  viewerElement.replaceChildren();

  viewer = new GaussianSplats3D.Viewer({
    rootElement: viewerElement,
    cameraUp: [0, -1, -0.6],
    initialCameraPosition: [0, -3, 2.2],
    initialCameraLookAt: [0, 0, 0],
    sharedMemoryForWorkers: false,
    gpuAcceleratedSort: false,
    integerBasedSort: false,
    optimizeSplatData: false,
    inMemoryCompressionLevel: 0,
    halfPrecisionCovariancesOnGPU: true,
    ignoreDevicePixelRatio: true,
    sphericalHarmonicsDegree: 0,
    sceneRevealMode: GaussianSplats3D.SceneRevealMode.Instant,
    webXRMode: GaussianSplats3D.WebXRMode.None
  });
}

function getLoadedSplatCount() {
  return viewer?.getSplatMesh?.()?.getSplatCount?.() ?? 0;
}

function updateModelInfo(model = activeModel, frame = lastFrame) {
  const splatCount = frame?.splatCount ?? getLoadedSplatCount();
  const radius = frame?.radius;
  const infoParts = [
    model?.name || getModelDisplayName(activeModels) || "Loaded model",
    `${splatCount.toLocaleString()} splats`
  ];

  if (activeModels.length > 1) infoParts.push(`${activeModels.length} blocks`);
  if (Number.isFinite(radius)) infoParts.push(`radius ${radius.toFixed(2)}`);
  if (pointModeEnabled) infoParts.push("point mode");

  modelInfo.textContent = infoParts.join(" · ");
  modelInfo.hidden = false;
  refreshDownloadButton();
}

function refreshDownloadButton() {
  if (!downloadOriginalButton) return;

  const canDownload = Boolean(
    isBackendEnabled()
    && currentSession.authenticated
    && activeModels.length === 1
    && activeModels[0]?.id
    && !activeModels[0]?.sharedViewOnly
    && currentModelSource !== "share"
  );

  downloadOriginalButton.hidden = !canDownload;
  downloadOriginalButton.disabled = !canDownload;
}

function setPointMode(enabled) {
  const splatMesh = viewer?.getSplatMesh?.();
  if (!splatMesh) return false;

  pointModeEnabled = enabled;
  splatMesh.setPointCloudModeEnabled(enabled);
  splatMesh.setSplatScale(enabled ? 1.35 : 1);
  pointModeButton.textContent = enabled ? "Splats" : "Points";
  pointModeButton.disabled = false;
  updateModelInfo(activeModel);
  viewer?.forceRenderNextFrame?.();
  return true;
}

function computeModelFrame() {
  const splatMesh = viewer?.getSplatMesh?.();
  const splatCount = splatMesh?.getSplatCount?.() ?? 0;
  if (!splatMesh || splatCount <= 0) return null;

  const center = new THREE.Vector3();
  const min = new THREE.Vector3(Infinity, Infinity, Infinity);
  const max = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
  const sampleCount = Math.min(4000, splatCount);
  const step = Math.max(1, Math.floor(splatCount / sampleCount));

  for (let index = 0; index < splatCount; index += step) {
    splatMesh.getSplatCenter(index, center, true);
    min.min(center);
    max.max(center);
  }

  if (!Number.isFinite(min.x) || !Number.isFinite(max.x)) return null;

  const target = min.clone().add(max).multiplyScalar(0.5);
  const size = max.clone().sub(min);
  const radius = Math.max(size.length() * 0.55, 0.5);

  return { target, radius, splatCount };
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return "unknown size";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex++;
  }

  return `${value.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function frameModel() {
  const frame = computeModelFrame() || lastFrame;
  if (!frame || !viewer?.camera || !viewer?.controls) return false;

  lastFrame = frame;
  const distance = Math.max(frame.radius * 2.4, 1.5);
  const cameraOffset = new THREE.Vector3(distance, -distance, distance * 0.65);

  viewer.camera.position.copy(frame.target).add(cameraOffset);
  viewer.camera.up.set(0, 0, 1);
  viewer.camera.near = Math.max(distance / 1000, 0.01);
  viewer.camera.far = Math.max(distance * 100, 1000);
  viewer.camera.lookAt(frame.target);
  viewer.camera.updateProjectionMatrix();

  viewer.controls.target.copy(frame.target);
  viewer.controls.update();
  viewer.forceRenderNextFrame?.();
  frameButton.disabled = false;
  updateModelInfo(activeModel, frame);
  return true;
}

function normalizeManifest(rawManifest) {
  const manifestModels = Array.isArray(rawManifest)
    ? rawManifest
    : rawManifest?.models;

  if (!Array.isArray(manifestModels)) return [];

  return manifestModels
    .map((model, index) => {
      if (typeof model === "string") {
        const name = model.split("/").pop() || `Model ${index + 1}`;
        return {
          id: slugify(name),
          name,
          slug: slugify(name),
          path: model
        };
      }

      const name = model.name || model.title || `Model ${index + 1}`;
      const path = model.path || model.url;
      const filename = model.filename || path?.split("/").pop() || name;
      const extension = getExtensionFromPath(filename || path || "");
      const progressiveDefault = extension === ".splat" || extension === ".ksplat";

      return {
        id: model.id || model.modelId || model.slug || slugify(name || path),
        name,
        slug: model.slug || slugify(name || path),
        path,
        filename,
        size: model.size,
        format: model.format,
        ownerId: model.ownerId,
        ownerEmail: model.ownerEmail,
        isDemo: Boolean(model.isDemo || model.demo),
        position: model.position,
        rotation: model.rotation,
        scale: model.scale,
        sharedViewOnly: Boolean(model.sharedViewOnly),
        alphaThreshold: model.alphaThreshold ?? model.splatAlphaRemovalThreshold ?? 0,
        progressiveLoad: model.progressiveLoad ?? progressiveDefault
      };
    })
    .filter((model) => model.path);
}

function modelPathToUrl(path) {
  try {
    return new URL(path, window.location.href).href;
  } catch {
    return path;
  }
}

function getExtensionFromPath(path) {
  const cleanPath = path.split("?")[0].split("#")[0].toLowerCase();
  return SUPPORTED_EXTENSIONS.find((extension) => cleanPath.endsWith(extension));
}

function getSceneFormat(model) {
  if (model.format && GaussianSplats3D.SceneFormat[model.format] !== undefined) {
    return GaussianSplats3D.SceneFormat[model.format];
  }

  const extension = getExtensionFromPath(model.filename || model.path || "");
  return extension ? sceneFormatByExtension[extension] : undefined;
}

function fillModelSelect() {
  modelSelect.replaceChildren();

  if (!models.length) {
    const option = document.createElement("option");
    option.textContent = "No hosted models";
    modelSelect.append(option);
    modelSelect.disabled = true;
    loadSelectedButton.disabled = true;
    reloadButton.disabled = true;
    frameButton.disabled = false;
    pointModeButton.disabled = true;
    return;
  }

  for (const [index, model] of models.entries()) {
    const option = document.createElement("option");
    option.value = String(index);
    option.textContent = model.name;
    modelSelect.append(option);
  }

  modelSelect.disabled = false;
  loadSelectedButton.disabled = false;
  reloadButton.disabled = false;
  frameButton.disabled = false;
  pointModeButton.disabled = true;
}

function modelsChanged(nextModels) {
  if (nextModels.length !== models.length) return true;

  return nextModels.some((model, index) => {
    const current = models[index];
    return model.id !== current?.id
      || model.path !== current?.path
      || model.name !== current?.name
      || model.status !== current?.status;
  });
}

async function refreshHostedModels({ silent = true } = {}) {
  if (!isBackendEnabled() || activeObjectUrl) return;
  if (document.documentElement.dataset.state === "loading" || activeModels.length) return;
  const searchParams = new URLSearchParams(window.location.search);
  if (searchParams.has("share")) return;

  const nextModels = await loadManifest().catch((error) => {
    if (!silent) showToast(error?.message || "Could not refresh models.");
    return null;
  });

  if (!nextModels || !modelsChanged(nextModels)) return;

  const previousSelection = getSelectedModelIndexes()
    .map((index) => models[index]?.id || models[index]?.slug)
    .filter(Boolean);

  models = nextModels;
  fillModelSelect();

  const nextSelection = previousSelection
    .map((id) => models.findIndex((model) => model.id === id || model.slug === id))
    .filter((index) => index >= 0);
  selectModelIndexes(nextSelection);

  if (!activeModels.length && models.length) {
    showReadyState();
    showToast("A newly approved model is ready.");
  }
}

function startModelRefreshPolling() {
  if (modelRefreshTimer || !isBackendEnabled()) return;

  modelRefreshTimer = window.setInterval(() => {
    if (document.hidden) return;
    refreshHostedModels({ silent: true });
  }, MODEL_REFRESH_INTERVAL_MS);
}

function getSelectedModelIndexes() {
  return [...modelSelect.selectedOptions]
    .map((option) => Number(option.value))
    .filter((index) => Number.isInteger(index) && models[index]);
}

function selectModelIndexes(indexes) {
  const selected = new Set(indexes.map(String));
  for (const option of modelSelect.options) {
    option.selected = selected.has(option.value);
  }
}

async function loadManifest() {
  const userModelsPayload = await getUserModels().catch((error) => {
    console.warn("User model API unavailable; falling back to static manifest.", error);
    return null;
  });

  if (userModelsPayload?.models) {
    currentModelSource = userModelsPayload.source || "api";
    return normalizeManifest(userModelsPayload.models);
  }

  try {
    const response = await fetch(APP_CONFIG.staticManifestUrl, { cache: "no-store" });
    if (!response.ok) return [];
    currentModelSource = "static";
    return normalizeManifest(await response.json());
  } catch {
    return [];
  }
}

function withTimeout(promise, milliseconds, message) {
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = window.setTimeout(() => reject(new Error(message)), milliseconds);
  });

  return Promise.race([promise, timeout]).finally(() => {
    window.clearTimeout(timeoutId);
  });
}

async function loadModel(model, sourceUrl = model.path) {
  activeModel = model;
  activeModels = [model];
  const loadToken = ++activeLoadToken;
  let sceneVisible = false;
  hideEmptyState();
  hideReadyState();
  const sizeHint = model.size ? ` • ${formatBytes(model.size)}` : "";
  showLoading("Loading model", `${model.name}${sizeHint}`);
  const markProgress = startLoadingWatchdog(model, loadToken);

  try {
    await loadViewerLibraries();
    resetViewer();
    frameButton.disabled = false;
    pointModeButton.disabled = true;
    modelInfo.hidden = true;
    lastFrame = null;
    pointModeEnabled = false;

    const format = getSceneFormat(model);
    if (format === undefined || format === null) {
      throw new Error("Unsupported or unknown Gaussian splat file format.");
    }

    if (model.size > LARGE_HOSTED_MODEL_BYTES && !model.progressiveLoad) {
      showToast("Large hosted model: progressive or tiled publishing is recommended.");
    }

    const statusName = {
      0: "Loading",
      1: "Preparing model",
      2: "Ready"
    };

    await viewer.addSplatScene(sourceUrl, {
      format,
      splatAlphaRemovalThreshold: model.alphaThreshold ?? 0,
      showLoadingUI: false,
      progressiveLoad: model.progressiveLoad ?? false,
      position: model.position ?? [0, 0, 0],
      rotation: model.rotation ?? [0, 0, 0, 1],
      scale: model.scale ?? [1, 1, 1],
      onProgress: (percentComplete, percentCompleteLabel, loaderStatus) => {
        if (loadToken !== activeLoadToken) return;
        const stage = statusName[loaderStatus] || "Loading";
        const percent = Number.isFinite(percentComplete) ? percentComplete : undefined;
        const percentLabel = percentCompleteLabel || (Number.isFinite(percent) ? `${Math.round(percent)}%` : "");
        const sizeText = model.size ? ` of ${formatBytes(model.size)}` : "";
        const progressText = `${stage} ${percentLabel}${sizeText}`;

        if (sceneVisible) {
          connectionLabel.textContent = loaderStatus === 2
            ? "Live"
            : `Loading ${percentLabel}`;
          updateModelInfo(model);
          return;
        }

        setModelLoadProgress(percent);
        markProgress(progressText);
        setStatus(stage, `${model.name} • ${progressText}`, "loading");
      }
    });

    if (loadToken !== activeLoadToken) return;

    viewer.start();
    sceneVisible = true;
    window.setTimeout(() => {
      if (loadToken !== activeLoadToken) return;
      const splatCount = getLoadedSplatCount();
      updateModelInfo(model);
      pointModeButton.disabled = splatCount <= 0;
      frameButton.disabled = false;
      pointModeButton.textContent = "Points";
      if (!frameModel()) showToast("Model loaded, but no frameable splats were found.");
    }, 100);
    setStatus("Live", model.name, "ready");
    hideLoading();
  } catch (error) {
    if (loadToken !== activeLoadToken) return;
    clearLoadingWatchdog();
    console.error(error);
    loadingPanel.classList.add("is-error");
    setStatus(
      "Model failed",
      error?.message || "Check the file path, format, size, and browser console.",
      "error"
    );
    showToast(error?.message || "Could not load model");
  } finally {
    refreshDownloadButton();
  }
}

async function loadHostedModel(index) {
  cleanObjectUrl();
  const model = models[index];
  if (!model) return;
  selectModelIndexes([index]);
  await loadModel(model, modelPathToUrl(model.path));
  updateShareUrl(model);
}

async function loadSelectedHostedModels() {
  cleanObjectUrl();
  const indexes = getSelectedModelIndexes();
  const selectedModels = indexes.map((index) => models[index]).filter(Boolean);

  if (!selectedModels.length) {
    showReadyState();
    showToast("Select one or more hosted blocks first.");
    return;
  }

  if (selectedModels.length === 1) {
    await loadHostedModel(indexes[0]);
    return;
  }

  activeModels = selectedModels;
  activeModel = {
    name: getModelDisplayName(selectedModels),
    size: getTotalModelSize(selectedModels)
  };

  const loadToken = ++activeLoadToken;
  let sceneVisible = false;
  const sizeHint = activeModel.size ? ` • ${formatBytes(activeModel.size)}` : "";
  hideEmptyState();
  hideReadyState();
  showLoading("Loading blocks", `${activeModel.name}${sizeHint}`);
  const markProgress = startLoadingWatchdog(activeModel, loadToken);

  try {
    await loadViewerLibraries();
    resetViewer();
    frameButton.disabled = false;
    pointModeButton.disabled = true;
    modelInfo.hidden = true;
    lastFrame = null;
    pointModeEnabled = false;

    const sceneOptions = selectedModels.map((model) => {
      const format = getSceneFormat(model);
      if (format === undefined || format === null) {
        throw new Error(`Unsupported format for ${model.name}.`);
      }

      return {
        path: modelPathToUrl(model.path),
        format,
        splatAlphaRemovalThreshold: model.alphaThreshold ?? 0,
        position: model.position ?? [0, 0, 0],
        rotation: model.rotation ?? [0, 0, 0, 1],
        scale: model.scale ?? [1, 1, 1]
      };
    });

    const statusName = {
      0: "Loading",
      1: "Preparing model",
      2: "Ready"
    };

    await viewer.addSplatScenes(sceneOptions, false, (percentComplete, percentCompleteLabel, loaderStatus) => {
      if (loadToken !== activeLoadToken) return;
      const stage = statusName[loaderStatus] || "Loading";
      const percent = Number.isFinite(percentComplete) ? percentComplete : undefined;
      const percentLabel = percentCompleteLabel || (Number.isFinite(percent) ? `${Math.round(percent)}%` : "");
      const sizeText = activeModel.size ? ` of ${formatBytes(activeModel.size)}` : "";
      const progressText = `${stage} ${percentLabel}${sizeText}`;

      if (sceneVisible) {
        connectionLabel.textContent = loaderStatus === 2
          ? "Live"
          : `Loading ${percentLabel}`;
        updateModelInfo(activeModel);
        return;
      }

      setModelLoadProgress(percent);
      markProgress(progressText);
      setStatus(stage, `${activeModel.name} • ${progressText}`, "loading");
    });

    if (loadToken !== activeLoadToken) return;

    viewer.start();
    sceneVisible = true;
    window.setTimeout(() => {
      if (loadToken !== activeLoadToken) return;
      const splatCount = getLoadedSplatCount();
      updateModelInfo(activeModel);
      pointModeButton.disabled = splatCount <= 0;
      frameButton.disabled = false;
      pointModeButton.textContent = "Points";
      if (!frameModel()) showToast("Blocks loaded, but no frameable splats were found.");
    }, 100);
    setStatus("Live", activeModel.name, "ready");
    updateShareUrl(selectedModels);
    hideLoading();
  } catch (error) {
    if (loadToken !== activeLoadToken) return;
    clearLoadingWatchdog();
    console.error(error);
    loadingPanel.classList.add("is-error");
    setStatus(
      "Blocks failed",
      error?.message || "Check the file paths, formats, sizes, and browser console.",
      "error"
    );
    showToast(error?.message || "Could not load selected blocks");
  } finally {
    refreshDownloadButton();
  }
}

async function loadLocalFile(file) {
  const lowerName = file.name.toLowerCase();
  const extension = SUPPORTED_EXTENSIONS.find((item) => lowerName.endsWith(item));
  if (!extension) {
    showToast("Use .ply, .splat, .ksplat, or .spz");
    return;
  }

  const previewLimit = extension === ".ply"
    ? MAX_LOCAL_PLY_PREVIEW_BYTES
    : MAX_LOCAL_PREVIEW_BYTES;

  if (file.size > previewLimit) {
    showToast(`This ${formatBytes(file.size)} file is too large for local preview.`);
    showUploadPanel();
    return;
  }

  cleanObjectUrl();
  activeObjectUrl = URL.createObjectURL(file);
  await loadModel(
    {
      name: file.name,
      path: activeObjectUrl,
      filename: file.name,
      progressiveLoad: false,
      alphaThreshold: 0
    },
    activeObjectUrl
  );
}

async function uploadSelectedCloudFile() {
  if (!selectedCloudUploadFile) {
    showToast("Choose a model file first.");
    return;
  }

  if (!isSupportedModelFile(selectedCloudUploadFile)) {
    showToast("Use .ply, .splat, .ksplat, or .spz");
    return;
  }

  if (!isBackendEnabled()) {
    showToast("Backend API is required for cloud uploads.");
    return;
  }

  await refreshSession();
  if (!currentSession.authenticated) {
    showToast("Sign in before uploading.");
    return;
  }

  cloudUploadButton.disabled = true;
  setUploadProgress("Creating secure upload session...", 1);

  try {
    const uploadSession = await createUploadSession(selectedCloudUploadFile);
    if (!uploadSession?.uploadUrl || !uploadSession?.modelId || !uploadSession?.key) {
      throw new Error("Upload session was not created.");
    }

    setUploadProgress("Uploading to secure storage...", 2);
    await uploadFileToSignedUrl({
      file: selectedCloudUploadFile,
      uploadUrl: uploadSession.uploadUrl,
      headers: uploadSession.headers,
      onProgress: (percent) => setUploadProgress(`Uploading ${percent}%`, percent)
    });

    setUploadProgress("Finalizing upload record...", 98);
    await completeUploadSession({
      modelId: uploadSession.modelId,
      key: uploadSession.key,
      file: selectedCloudUploadFile
    });

    setUploadProgress("Uploaded. Waiting for owner approval.", 100);
    showToast("Model uploaded for approval.");
    startModelRefreshPolling();
    selectedCloudUploadFile = null;
    if (cloudUploadInput) cloudUploadInput.value = "";
    refreshUploadControls();
  } catch (error) {
    console.error(error);
    setUploadProgress(error?.message || "Upload failed", 0);
    showToast(error?.message || "Upload failed");
  } finally {
    refreshUploadControls();
  }
}

async function shareDashboard() {
  let shareUrl = getShareUrl();
  if (!shareUrl) {
    showToast("Submit this model for approval before sharing.");
    showUploadPanel();
    return;
  }

  if (isBackendEnabled() && activeModels.length) {
    const modelIds = activeModels.map((model) => model.id || model.slug).filter(Boolean);
    const privateShareUrl = await createModelShare(modelIds).catch((error) => {
      console.warn("Could not create backend share link.", error);
      return null;
    });
    if (privateShareUrl) shareUrl = privateShareUrl;
  }

  const shareData = {
    title: "Gaussian Viewer",
    text: activeModel
      ? `Open ${activeModel.name} in Gaussian Viewer.`
      : "Open this self-hosted Gaussian splat viewer.",
    url: shareUrl
  };

  try {
    if (navigator.share) {
      await navigator.share(shareData);
      return;
    }

    await navigator.clipboard.writeText(shareData.url);
    showToast(activeModel ? "Model link copied" : "Dashboard link copied");
  } catch (error) {
    if (error?.name !== "AbortError") showToast("Could not copy the link");
  }
}

async function downloadOriginalModel() {
  if (!activeModels.length || activeModels.length !== 1 || activeModels[0]?.sharedViewOnly) {
    showToast("Original export is available only to the model owner.");
    return;
  }

  try {
    const payload = await getOwnerDownloadUrl(activeModels[0].id);
    if (!payload?.url) throw new Error("Original export link was not created.");

    const link = document.createElement("a");
    link.href = payload.url;
    link.download = payload.filename || activeModels[0].filename || activeModels[0].name || "model";
    link.rel = "noreferrer";
    document.body.append(link);
    link.click();
    link.remove();
    showToast("Owner export link opened.");
  } catch (error) {
    console.error(error);
    showToast(error?.message || "Original export is not available.");
  }
}

modelSelect.addEventListener("change", () => {
  if (!getSelectedModelIndexes().length) {
    showReadyState();
  }
});

loadSelectedButton.addEventListener("click", loadSelectedHostedModels);

reloadButton.addEventListener("click", () => {
  if (activeObjectUrl && activeModel) {
    loadModel(activeModel, activeObjectUrl);
    return;
  }

  if (activeModels.length > 1) {
    loadSelectedHostedModels();
    return;
  }

  const [selectedIndex] = getSelectedModelIndexes();
  if (selectedIndex !== undefined) loadHostedModel(selectedIndex);
});

frameButton.addEventListener("click", () => {
  if (!frameModel()) showToast("Could not frame this model");
});

pointModeButton.addEventListener("click", () => {
  if (!setPointMode(!pointModeEnabled)) showToast("Point mode is not available yet");
});

downloadOriginalButton?.addEventListener("click", downloadOriginalModel);
localModelButton.addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", () => {
  const [file] = fileInput.files;
  if (file) loadLocalFile(file);
  fileInput.value = "";
});

shareButton.addEventListener("click", shareDashboard);
accountAction?.addEventListener("click", async (event) => {
  event.preventDefault();

  if (accountAction.getAttribute("aria-disabled") === "true") {
    showToast("Connect Supabase Auth and backend API first.");
    return;
  }

  try {
    if (accountAction.dataset.action === "sign-out") {
      await signOut();
      await refreshSession();
      showToast("Signed out");
      return;
    }

    const choice = window.prompt(
      "Type one option:\n1 = sign in with password\n2 = create account with password\n3 = magic link email"
    );

    if (choice === "1") {
      await promptForPasswordAuth("sign in");
      return;
    }

    if (choice === "2") {
      await promptForPasswordAuth("sign up");
      return;
    }

    if (choice === "3") {
      await promptForMagicLink();
      return;
    }

    showToast("Sign-in cancelled.");
  } catch (error) {
    console.error(error);
    showToast(error?.message || "Sign-in failed");
  }
});
themeToggle?.addEventListener("click", () => {
  const nextTheme = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  applyTheme(nextTheme);
});
uploadHelpButton.addEventListener("click", showUploadPanel);
closeUploadPanel.addEventListener("click", hideUploadPanel);
cloudUploadInput?.addEventListener("change", () => {
  const [file] = cloudUploadInput.files;
  selectedCloudUploadFile = file || null;

  if (selectedCloudUploadFile && !isSupportedModelFile(selectedCloudUploadFile)) {
    showToast("Use .ply, .splat, .ksplat, or .spz");
    selectedCloudUploadFile = null;
    cloudUploadInput.value = "";
  }

  refreshUploadControls();
});
cloudUploadButton?.addEventListener("click", uploadSelectedCloudFile);
uploadPanel.addEventListener("click", (event) => {
  if (event.target === uploadPanel) hideUploadPanel();
});

window.addEventListener("dragenter", (event) => {
  event.preventDefault();
  dropZone.hidden = false;
});

window.addEventListener("dragover", (event) => {
  event.preventDefault();
});

window.addEventListener("dragleave", (event) => {
  if (event.relatedTarget) return;
  dropZone.hidden = true;
});

window.addEventListener("drop", (event) => {
  event.preventDefault();
  dropZone.hidden = true;
  const [file] = event.dataTransfer.files;
  if (file) loadLocalFile(file);
});

window.addEventListener("focus", () => {
  refreshHostedModels({ silent: true });
});

applyTheme(window.localStorage.getItem("gaussian-viewer-theme") || "light");

async function startDashboard() {
  try {
    showLoading("Preparing viewer", "Looking for self-hosted models...");
    await withTimeout(refreshSession(), 12000, "Session check timed out.");
    models = await withTimeout(loadManifest(), 15000, "Model list check timed out.");
    fillModelSelect();
    startModelRefreshPolling();

    if (!models.length) {
      showEmptyState();
      return;
    }

    const searchParams = new URLSearchParams(window.location.search);
    const shareToken = searchParams.get("share");
    const requestedModel = searchParams.get("model");
    const requestedModels = searchParams.get("models");

    if (shareToken && currentModelSource === "share") {
      const sharedIndexes = models.map((_, index) => index);
      selectModelIndexes(sharedIndexes);
      if (sharedIndexes.length === 1) {
        await loadHostedModel(sharedIndexes[0]);
      } else {
        await loadSelectedHostedModels();
      }
      showToast("Shared model loaded in view-only mode.");
      return;
    }

    if (!requestedModel && !requestedModels) {
      selectModelIndexes([]);
      showReadyState();
      return;
    }

    const requestedSlugs = requestedModels
      ? requestedModels.split(",").map((value) => value.trim()).filter(Boolean)
      : [requestedModel];

    const requestedIndexes = requestedSlugs
      .map((requestedSlug) => models.findIndex((model) => {
        const slug = model.slug || slugify(model.name);
        return slug === requestedSlug || model.name === requestedSlug;
      }))
      .filter((index) => index >= 0);

    if (!requestedIndexes.length) {
      selectModelIndexes([]);
      showReadyState();
      showToast("Shared model was not found.");
      return;
    }

    selectModelIndexes(requestedIndexes);
    if (requestedIndexes.length === 1) {
      await loadHostedModel(requestedIndexes[0]);
    } else {
      await loadSelectedHostedModels();
    }
  } catch (error) {
    console.error(error);
    models = [];
    fillModelSelect();
    showEmptyState();
    showToast(error?.message || "Could not finish startup check.");
  }
}

startDashboard();
