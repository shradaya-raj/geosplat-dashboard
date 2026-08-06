import {
  completeUploadSession,
  createModelShare,
  createUploadSession,
  deleteHostedFile,
  deleteHostedProject,
  getLoginUrl,
  getLogoutUrl,
  getOwnerDownloadUrl,
  getSession,
  getUserModels,
  getUserProjects,
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
const UPLOAD_EXTENSIONS_BY_TYPE = {
  mesh_3d: [".obj", ".fbx", ".glb", ".gltf", ".stl", ".dae", ".3dm", ".zip"],
  gaussian_splatting: [".ply", ".splat", ".ksplat", ".spz"],
  point_cloud: [".ply", ".las", ".laz", ".pcd", ".xyz", ".pts", ".e57", ".zip"],
  orthomosaic: [".tif", ".tiff", ".geotiff", ".png", ".jpg", ".jpeg", ".webp", ".jp2", ".zip"]
};
const ASSET_TYPE_LABELS = {
  mesh_3d: "3D Mesh",
  gaussian_splatting: "Gaussian Splatting",
  point_cloud: "Point Cloud",
  orthomosaic: "Ortho / Orthomosaic"
};
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
const deleteSelectedButton = document.querySelector("#delete-selected");
const localModelButton = document.querySelector("#local-model");
const fileInput = document.querySelector("#file-input");
const shareButton = document.querySelector("#share-button");
const themeToggle = document.querySelector("#theme-toggle");
const uploadHelpButton = document.querySelector("#upload-help-button");
const profileMenuButton = document.querySelector("#profile-menu-button");
const profileMenu = document.querySelector("#profile-menu");
const uploadPanel = document.querySelector("#upload-panel");
const closeUploadPanel = document.querySelector("#close-upload-panel");
const cloudUploadButton = document.querySelector("#cloud-upload-button");
const uploadProjectName = document.querySelector("#upload-project-name");
const uploadAssetTypeInputs = [...document.querySelectorAll("[data-upload-asset-type]")];
const uploadFileInputs = [...document.querySelectorAll("[data-upload-file-input]")];
const uploadFileGroups = [...document.querySelectorAll("[data-upload-file-group]")];
const uploadFileSummaries = new Map(
  [...document.querySelectorAll("[data-upload-file-summary]")]
    .map((element) => [element.dataset.uploadFileSummary, element])
);
const uploadFileDetails = new Map(
  [...document.querySelectorAll("[data-upload-file-detail]")]
    .map((element) => [element.dataset.uploadFileDetail, element])
);
const uploadFileDetailToggles = new Map(
  [...document.querySelectorAll("[data-upload-file-toggle]")]
    .map((element) => [element.dataset.uploadFileToggle, element])
);
const uploadProgress = document.querySelector("#upload-progress");
const uploadFileName = document.querySelector("#upload-file-name");
const uploadProgressBar = document.querySelector("#upload-progress-bar");
const uploadProgressLabel = document.querySelector("#upload-progress-label");
const confirmPanel = document.querySelector("#confirm-panel");
const confirmTitle = document.querySelector("#confirm-title");
const confirmMessage = document.querySelector("#confirm-message");
const confirmAccept = document.querySelector("#confirm-accept");
const confirmCancel = document.querySelector("#confirm-cancel");
const confirmCancelX = document.querySelector("#confirm-cancel-x");
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
let selectedCloudUploadFiles = [];
let selectedUploadFilesByType = new Map();
let currentModelSource = "static";
let modelRefreshTimer = null;
let modelSelectEntries = [];
let notifiedPublishedModelIds = new Set();
let uploadAwaitingApproval = false;

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
    const nextLabel = normalizedTheme === "dark" ? "Switch to light theme" : "Switch to dark theme";
    themeToggle.textContent = normalizedTheme === "dark" ? "☀" : "☾";
    themeToggle.setAttribute("aria-label", nextLabel);
    themeToggle.title = nextLabel;
  }
}

function animateThemeSwap() {
  document.documentElement.classList.remove("is-theme-swapping");
  window.requestAnimationFrame(() => {
    document.documentElement.classList.add("is-theme-swapping");
    window.setTimeout(() => {
      document.documentElement.classList.remove("is-theme-swapping");
    }, 680);
  });
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
    accountHint.textContent = "Private sign-in needs the secure workspace API. Public demo/hosted models are shown for now.";
    accountAction.hidden = false;
    accountAction.href = "#backend-setup";
    accountAction.textContent = "Backend setup pending";
    accountAction.setAttribute("aria-disabled", "true");
    if (profileMenuButton) profileMenuButton.dataset.state = "offline";
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
    if (profileMenuButton) {
      profileMenuButton.dataset.state = "signed-in";
      profileMenuButton.title = email;
      profileMenuButton.setAttribute("aria-label", `Profile: ${email}`);
    }
    return;
  }

  accountStatus.textContent = "Not signed in";
  accountHint.textContent = isSupabaseAuthEnabled()
    ? "Sign in with email to view your private model workspace."
    : "Connect secure sign-in to enable private workspaces.";
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
  if (profileMenuButton) {
    profileMenuButton.dataset.state = "signed-out";
    profileMenuButton.title = "Sign in";
    profileMenuButton.setAttribute("aria-label", "Open profile menu");
  }
}

function showUploadPanel() {
  uploadPanel.hidden = false;
  if (isBackendEnabled() && !currentSession.authenticated) {
    showToast("Sign in from the profile icon before uploading.");
  }
  refreshUploadControls();
}

function hideUploadPanel() {
  uploadPanel.hidden = true;
}

function hideConfirmPanel() {
  if (confirmPanel) confirmPanel.hidden = true;
}

function showConfirmDialog({
  title = "Confirm action",
  message = "Please confirm this action.",
  acceptLabel = "Confirm",
  danger = true
} = {}) {
  if (!confirmPanel || !confirmAccept || !confirmCancel || !confirmCancelX) {
    return Promise.resolve(window.confirm(message));
  }

  confirmTitle.textContent = title;
  confirmMessage.textContent = message;
  confirmAccept.textContent = acceptLabel;
  confirmAccept.classList.toggle("button-danger", danger);
  confirmAccept.classList.toggle("button-primary", !danger);
  confirmPanel.hidden = false;

  return new Promise((resolve) => {
    const finish = (value) => {
      hideConfirmPanel();
      confirmAccept.removeEventListener("click", accept);
      confirmCancel.removeEventListener("click", cancel);
      confirmCancelX.removeEventListener("click", cancel);
      confirmPanel.removeEventListener("click", backdrop);
      resolve(value);
    };
    const accept = () => finish(true);
    const cancel = () => finish(false);
    const backdrop = (event) => {
      if (event.target === confirmPanel) finish(false);
    };

    confirmAccept.addEventListener("click", accept);
    confirmCancel.addEventListener("click", cancel);
    confirmCancelX.addEventListener("click", cancel);
    confirmPanel.addEventListener("click", backdrop);
  });
}

async function handleAccountAction() {
  if (!accountAction) return false;

  if (accountAction.getAttribute("aria-disabled") === "true") {
    showToast("Connect secure sign-in first.");
    return false;
  }

  try {
    if (accountAction.dataset.action === "sign-out") {
      await signOut();
      await refreshSession();
      showToast("Signed out");
      hideProfileMenu();
      return true;
    }

    const choice = window.prompt(
      "Type one option:\n1 = sign in with password\n2 = create account with password\n3 = magic link email"
    );

    if (choice === "1") return promptForPasswordAuth("sign in");
    if (choice === "2") return promptForPasswordAuth("sign up");
    if (choice === "3") return promptForMagicLink();

    showToast("Sign-in cancelled.");
    return false;
  } catch (error) {
    console.error(error);
    showToast(error?.message || "Sign-in failed");
    return false;
  }
}

function showProfileMenu() {
  if (!profileMenu || !profileMenuButton) return;
  profileMenu.hidden = false;
  profileMenuButton.setAttribute("aria-expanded", "true");
}

function hideProfileMenu() {
  if (!profileMenu || !profileMenuButton) return;
  profileMenu.hidden = true;
  profileMenuButton.setAttribute("aria-expanded", "false");
}

function toggleProfileMenu() {
  if (!profileMenu) return;
  if (profileMenu.hidden) showProfileMenu();
  else hideProfileMenu();
}

function isSupportedModelFile(file) {
  if (!file?.name) return false;
  const lowerName = file.name.toLowerCase();
  return SUPPORTED_EXTENSIONS.some((extension) => lowerName.endsWith(extension));
}

function getSelectedUploadAssetTypes() {
  return uploadAssetTypeInputs
    .filter((input) => input.checked)
    .map((input) => input.value);
}

function isSupportedAssetUploadFile(file, assetType = "gaussian_splatting") {
  if (!file?.name) return false;
  const lowerName = file.name.toLowerCase();
  const extensions = UPLOAD_EXTENSIONS_BY_TYPE[assetType] || UPLOAD_EXTENSIONS_BY_TYPE.gaussian_splatting;
  return extensions.some((extension) => lowerName.endsWith(extension));
}

function getUploadFilesByType() {
  const selectedTypes = new Set(getSelectedUploadAssetTypes());
  const filesByType = new Map();

  for (const [assetType, files] of selectedUploadFilesByType.entries()) {
    if (!selectedTypes.has(assetType)) continue;
    if (files.length) filesByType.set(assetType, files);
  }

  return filesByType;
}

function getUploadSelectionSummary() {
  const filesByType = getUploadFilesByType();
  const files = [...filesByType.values()].flat();
  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
  return { filesByType, files, totalBytes };
}

function updateUploadFileSummaries() {
  const selectedTypes = new Set(getSelectedUploadAssetTypes());

  for (const assetType of Object.keys(ASSET_TYPE_LABELS)) {
    const files = selectedUploadFilesByType.get(assetType) || [];
    const bytes = files.reduce((sum, file) => sum + file.size, 0);
    const summary = uploadFileSummaries.get(assetType);
    const detail = uploadFileDetails.get(assetType);
    const toggle = uploadFileDetailToggles.get(assetType);

    if (summary) {
      summary.textContent = files.length
        ? `${files.length} file${files.length === 1 ? "" : "s"} • ${formatBytes(bytes)}`
        : "No files selected";
    }

    if (toggle) {
      toggle.hidden = files.length === 0;
      const isExpanded = detail?.hidden === false;
      toggle.dataset.expanded = String(isExpanded);
      toggle.setAttribute("aria-expanded", String(isExpanded));
      toggle.setAttribute("aria-label", `${isExpanded ? "Hide" : "Show"} selected ${ASSET_TYPE_LABELS[assetType]} files`);
    }

    if (detail) {
      detail.innerHTML = "";
      detail.hidden = detail.hidden || files.length === 0 || !selectedTypes.has(assetType);

      if (files.length) {
        const list = document.createElement("ul");
        list.className = "upload-file-list";

        for (const file of files) {
          const item = document.createElement("li");
          const name = document.createElement("span");
          const size = document.createElement("small");

          name.textContent = file.name;
          size.textContent = formatBytes(file.size);
          item.append(name, size);
          list.append(item);
        }

        detail.append(list);
      }
    }
  }

  selectedCloudUploadFiles = getUploadSelectionSummary().files;
}

function addUploadFiles(assetType, files) {
  const existing = selectedUploadFilesByType.get(assetType) || [];
  const nextFiles = [...existing];
  const seen = new Set(existing.map((file) => `${file.name}:${file.size}:${file.lastModified}`));

  for (const file of files) {
    const fileKey = `${file.name}:${file.size}:${file.lastModified}`;
    if (seen.has(fileKey)) continue;
    nextFiles.push(file);
    seen.add(fileKey);
  }

  selectedUploadFilesByType.set(assetType, nextFiles);
}

function updateUploadTypeVisibility() {
  const selectedTypes = new Set(getSelectedUploadAssetTypes());

  for (const group of uploadFileGroups) {
    const assetType = group.dataset.uploadFileGroup;
    const isVisible = selectedTypes.has(assetType);
    group.hidden = !isVisible;

    if (!isVisible) {
      const input = uploadFileInputs.find((fileInputElement) => fileInputElement.dataset.uploadFileInput === assetType);
      if (input) input.value = "";
      selectedUploadFilesByType.delete(assetType);
    }
  }

  updateUploadFileSummaries();
  refreshUploadControls();
}

function setUploadProgress(label, percent = 0) {
  if (!uploadProgress || !uploadProgressBar || !uploadProgressLabel) return;

  uploadProgress.hidden = false;
  uploadProgressBar.value = Math.max(0, Math.min(100, percent));
  uploadProgressLabel.textContent = label;
}

function refreshUploadControls() {
  if (!cloudUploadButton) return;

  if (uploadAwaitingApproval) {
    cloudUploadButton.disabled = false;
    cloudUploadButton.textContent = "Wait";
    cloudUploadButton.classList.remove("button-primary");
    cloudUploadButton.classList.add("button-secondary");
    return;
  }

  const { files, totalBytes } = getUploadSelectionSummary();
  selectedCloudUploadFiles = files;
  const hasProjectName = Boolean(uploadProjectName?.value?.trim());

  const canUpload = Boolean(
    isBackendEnabled()
    && currentSession.authenticated
    && hasProjectName
    && selectedCloudUploadFiles.length
    && getSelectedUploadAssetTypes().length
  );

  cloudUploadButton.disabled = !canUpload;
  cloudUploadButton.textContent = "Upload for approval";
  cloudUploadButton.classList.add("button-primary");
  cloudUploadButton.classList.remove("button-secondary");

  if (uploadFileName) {
    uploadFileName.textContent = selectedCloudUploadFiles.length
      ? `${selectedCloudUploadFiles.length} file${selectedCloudUploadFiles.length === 1 ? "" : "s"} selected (${formatBytes(totalBytes)})`
      : "No files selected";
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
  setStatus("Choose project", "Approved Gaussian projects are available.", "ready");
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
        displayName: model.projectName ? `${model.projectName} — ${name}` : name,
        slug: model.slug || slugify(name || path),
        path,
        filename,
        size: model.size,
        format: model.format,
        projectId: model.projectId,
        projectName: model.projectName,
        projectSlug: model.projectSlug,
        assetType: model.assetType || "gaussian_splatting",
        assetTypeLabel: model.assetTypeLabel || ASSET_TYPE_LABELS[model.assetType] || "Gaussian Splatting",
        status: model.status || "published",
        canLoad: model.canLoad ?? Boolean(path),
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
    .filter((model) => model.path || model.id);
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

function normalizeProjectsToManifest(projects = []) {
  const projectModels = [];

  for (const project of projects) {
    const assetsByType = project.assetsByType || {};
    const assets = Object.values(assetsByType)
      .flatMap((group) => Array.isArray(group?.files) ? group.files : []);
    const countedAssets = Number(project.totalAssetCount);
    const countedApprovedAssets = Number(project.approvedAssetCount);
    const assetCountFallback = project.assetCounts
      ? Object.values(project.assetCounts).reduce((sum, count) => sum + Number(count || 0), 0)
      : assets.length;
    const totalAssets = Number.isFinite(countedAssets) ? countedAssets : assetCountFallback;
    const approvedAssets = Number.isFinite(countedApprovedAssets)
      ? countedApprovedAssets
      : assets.filter((asset) => asset.status === "published").length;

    if (!assets.length) {
      projectModels.push({
        id: `project:${project.id}`,
        name: project.name,
        slug: project.slug,
        projectId: project.id,
        projectName: project.name,
        projectSlug: project.slug,
        status: project.status || "active",
        canLoad: false,
        projectTotalAssets: totalAssets,
        projectApprovedAssets: approvedAssets
      });
      continue;
    }

    for (const asset of assets) {
      projectModels.push({
        ...asset,
        id: asset.id || `${project.id}:${asset.filename || asset.name}`,
        name: asset.name || asset.filename || project.name,
        slug: asset.slug || slugify(asset.name || asset.filename || project.name),
        projectId: project.id,
        projectName: project.name,
        projectSlug: project.slug,
        projectTotalAssets: totalAssets,
        projectApprovedAssets: approvedAssets,
        canLoad: Boolean(asset.canLoad && asset.path && asset.assetType === "gaussian_splatting")
      });
    }
  }

  return normalizeManifest(projectModels);
}

function getProjectStatusSummary(entry) {
  const statusCounts = entry.indexes.reduce((counts, index) => {
    const status = models[index]?.status || "published";
    counts[status] = (counts[status] || 0) + 1;
    return counts;
  }, {});
  const loadableCount = entry.indexes.filter((index) => models[index]?.canLoad).length;

  if (statusCounts.pending) return `⏳ Pending review • ${statusCounts.pending}/${entry.indexes.length}`;
  if (statusCounts.processing) return `⚙ Processing • ${statusCounts.processing}/${entry.indexes.length}`;
  if (statusCounts.uploading) return `⇧ Uploading • ${statusCounts.uploading}/${entry.indexes.length}`;
  if (statusCounts.rejected) return `⚠ Rejected • ${statusCounts.rejected}/${entry.indexes.length}`;
  if (loadableCount) {
    const fileLabel = entry.indexes.length === 1 ? "1 file" : `${entry.indexes.length} files`;
    return `✓ Ready • ${fileLabel}`;
  }

  return "• Not ready";
}

function getProjectApprovalSummary(entry) {
  const statusCounts = entry.indexes.reduce((counts, index) => {
    const status = models[index]?.status || "published";
    counts[status] = (counts[status] || 0) + 1;
    return counts;
  }, {});
  const totalAssets = entry.totalAssets ?? entry.indexes.length;
  const approvedAssets = entry.approvedAssets ?? entry.indexes.filter((index) => models[index]?.status === "published").length;
  const approvedRatio = `${approvedAssets}/${Math.max(totalAssets, 1)} approved`;

  if (totalAssets > 0 && approvedAssets === totalAssets) return `✓ Ready • ${approvedRatio}`;
  if (approvedAssets > 0) return `◐ Partial • ${approvedRatio}`;
  if (statusCounts.pending) return `⏳ Pending • ${approvedRatio}`;
  if (statusCounts.processing) return `⚙ Processing • ${approvedRatio}`;
  if (statusCounts.uploading) return `⇧ Uploading • ${approvedRatio}`;
  if (statusCounts.rejected) return `⚠ Rejected • ${approvedRatio}`;

  return `• Not ready • ${approvedRatio}`;
}

function fillModelSelect() {
  modelSelect.replaceChildren();
  modelSelectEntries = [];

  if (!models.length) {
    const option = document.createElement("option");
    option.textContent = "No projects";
    modelSelect.append(option);
    modelSelect.disabled = true;
    loadSelectedButton.disabled = true;
    reloadButton.disabled = true;
    frameButton.disabled = false;
    pointModeButton.disabled = true;
    if (deleteSelectedButton) deleteSelectedButton.disabled = true;
    return;
  }

  const grouped = new Map();
  for (const [index, model] of models.entries()) {
    const key = model.projectId || `model:${model.id || index}`;
    if (!grouped.has(key)) {
      grouped.set(key, {
        label: model.projectName || model.name,
        indexes: [],
        size: 0,
        totalAssets: model.projectTotalAssets || 0,
        approvedAssets: model.projectApprovedAssets || 0
      });
    }
    const entry = grouped.get(key);
    entry.indexes.push(index);
    entry.size += Number(model.size || 0);
    entry.totalAssets = Math.max(entry.totalAssets || 0, model.projectTotalAssets || 0);
    entry.approvedAssets = Math.max(entry.approvedAssets || 0, model.projectApprovedAssets || 0);
  }

  for (const entry of grouped.values()) {
    modelSelectEntries.push(entry);
    const option = document.createElement("option");
    option.value = String(modelSelectEntries.length - 1);
    option.textContent = `${entry.label} — ${getProjectApprovalSummary(entry)}`;
    modelSelect.append(option);
  }

  modelSelect.disabled = false;
  loadSelectedButton.disabled = false;
  reloadButton.disabled = false;
  frameButton.disabled = false;
  pointModeButton.disabled = true;
  if (deleteSelectedButton) deleteSelectedButton.disabled = true;
}

function modelsChanged(nextModels) {
  if (nextModels.length !== models.length) return true;

  return nextModels.some((model, index) => {
    const current = models[index];
    const nextPath = model.path?.split("?")[0] || "";
    const currentPath = current?.path?.split("?")[0] || "";
    return model.id !== current?.id
      || nextPath !== currentPath
      || model.name !== current?.name
      || model.status !== current?.status;
  });
}

function getPublishedModelIds(modelList = []) {
  return new Set(
    modelList
      .filter((model) => model.status === "published")
      .map((model) => model.id || model.slug || model.name)
      .filter(Boolean)
  );
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

  const nextPublishedIds = getPublishedModelIds(nextModels);
  const newlyPublishedIds = [...nextPublishedIds].filter((id) => !notifiedPublishedModelIds.has(id));

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
    if (newlyPublishedIds.length) {
      showToast(`${newlyPublishedIds.length} newly approved file${newlyPublishedIds.length === 1 ? "" : "s"} ready.`);
    }
  }

  notifiedPublishedModelIds = new Set([...notifiedPublishedModelIds, ...nextPublishedIds]);
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
    .filter((index) => Number.isInteger(index) && modelSelectEntries[index])
    .flatMap((entryIndex) => modelSelectEntries[entryIndex].indexes)
    .filter((index) => Number.isInteger(index) && models[index]);
}

function getSelectedProjectEntries() {
  return [...modelSelect.selectedOptions]
    .map((option) => modelSelectEntries[Number(option.value)])
    .filter(Boolean);
}

function selectModelIndexes(indexes) {
  const selectedIndexes = new Set(indexes);
  for (const option of modelSelect.options) {
    const entry = modelSelectEntries[Number(option.value)];
    option.selected = Boolean(entry?.indexes.some((index) => selectedIndexes.has(index)));
  }
}

async function loadManifest() {
  const shareToken = new URLSearchParams(window.location.search).get("share");

  if (!shareToken && currentSession.authenticated) {
    const projectsPayload = await getUserProjects().catch((error) => {
      console.warn("Project API unavailable; falling back to model list.", error);
      return null;
    });

    if (projectsPayload?.projects) {
      currentModelSource = "user";
      return normalizeProjectsToManifest(projectsPayload.projects);
    }
  }

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
  const loadableIndexes = indexes.filter((index) => models[index]?.canLoad && models[index]?.path);
  const selectedModels = loadableIndexes
    .map((index) => models[index])
    .filter((model) => model?.canLoad && model.path);

  if (!selectedModels.length) {
    showReadyState();
    showToast("Selected project has no approved Gaussian blocks yet. You can delete it or wait for approval.");
    return;
  }

  if (selectedModels.length === 1) {
    await loadHostedModel(loadableIndexes[0]);
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
  const { filesByType, files } = getUploadSelectionSummary();
  selectedCloudUploadFiles = files;

  const projectName = uploadProjectName?.value?.trim();
  if (!projectName) {
    showToast("Add a project name before submitting for approval.");
    uploadProjectName?.focus();
    return;
  }

  if (!getSelectedUploadAssetTypes().length) {
    showToast("Select at least one data type for this project.");
    return;
  }

  if (!selectedCloudUploadFiles.length) {
    showToast("Choose at least one file for the selected data type.");
    return;
  }

  for (const [assetType, typeFiles] of filesByType.entries()) {
    const assetLabel = ASSET_TYPE_LABELS[assetType] || "selected data type";
    const unsupported = typeFiles.find((file) => !isSupportedAssetUploadFile(file, assetType));
    if (unsupported) {
      showToast(`${unsupported.name} is not supported for ${assetLabel}.`);
      return;
    }
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
  setUploadProgress(`Preparing ${selectedCloudUploadFiles.length} file${selectedCloudUploadFiles.length === 1 ? "" : "s"}...`, 1);

  try {
    let projectId = null;
    const totalFiles = selectedCloudUploadFiles.length;
    let processedFiles = 0;
    const uploadBatchId = crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;

    for (const [assetType, typeFiles] of filesByType.entries()) {
      const assetLabel = ASSET_TYPE_LABELS[assetType] || "data";

      for (const file of typeFiles) {
        const baseProgress = Math.round((processedFiles / totalFiles) * 100);
        setUploadProgress(`Preparing ${assetLabel} ${processedFiles + 1}/${totalFiles}: ${file.name}`, baseProgress);

        const uploadSession = await createUploadSession(file, {
          projectId,
          projectName,
          assetType
        });
        if (!uploadSession?.uploadUrl || !uploadSession?.modelId || !uploadSession?.key) {
          throw new Error("Upload session was not created.");
        }

        projectId = uploadSession.projectId || projectId;

        await uploadFileToSignedUrl({
          file,
          uploadUrl: uploadSession.uploadUrl,
          headers: uploadSession.headers,
          onProgress: (percent) => {
            const fileProgress = percent / totalFiles;
            setUploadProgress(
              `Uploading ${assetLabel} ${processedFiles + 1}/${totalFiles}: ${percent}%`,
              Math.min(96, baseProgress + fileProgress)
            );
          }
        });

        setUploadProgress(`Finalizing ${assetLabel} ${processedFiles + 1}/${totalFiles}...`, Math.min(98, baseProgress + 95 / totalFiles));
        await completeUploadSession({
          modelId: uploadSession.modelId,
          key: uploadSession.key,
          file,
          uploadBatch: {
            id: uploadBatchId,
            index: processedFiles,
            total: totalFiles
          }
        });

        processedFiles += 1;
      }
    }

    setUploadProgress("Uploaded. Waiting for owner approval.", 100);
    showToast(`${selectedCloudUploadFiles.length} file${selectedCloudUploadFiles.length === 1 ? "" : "s"} uploaded for approval.`);
    startModelRefreshPolling();
    selectedCloudUploadFiles = [];
    selectedUploadFilesByType = new Map();
    uploadAwaitingApproval = true;
    for (const input of uploadFileInputs) input.value = "";
    updateUploadFileSummaries();
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

async function deleteSelectedHostedFiles() {
  const selectedEntries = getSelectedProjectEntries();
  const indexes = getSelectedModelIndexes();
  const selectedModels = indexes.map((index) => models[index]).filter(Boolean);

  if (!selectedEntries.length && !selectedModels.length) {
    showToast("Select one or more projects first.");
    return;
  }

  if (!currentSession.authenticated || currentModelSource === "share") {
    showToast("Sign in as the owner before deleting files.");
    return;
  }

  const projectEntries = selectedEntries.filter((entry) => entry.indexes.some((index) => models[index]?.projectId));
  const selectedProjectModels = selectedModels.filter((model) => model.projectId);
  const standaloneModels = selectedModels.filter((model) => !model.projectId);
  const projectIds = [...new Set([
    ...projectEntries
      .map((entry) => entry.indexes.map((index) => models[index]?.projectId).find(Boolean))
      .filter(Boolean),
    ...selectedProjectModels
      .map((model) => model.projectId)
      .filter(Boolean)
  ])];
  const projectNames = [...new Set([
    ...projectEntries
      .map((entry) => entry.label)
      .filter(Boolean),
    ...selectedProjectModels
      .map((model) => model.projectName)
      .filter(Boolean)
  ])];
  const fallbackNames = standaloneModels.map((model) => model.name).filter(Boolean);
  const deleteNames = projectNames.length ? projectNames : fallbackNames;
  const titleTarget = deleteNames.length === 1
    ? deleteNames[0]
    : `${deleteNames.length || selectedModels.length} selected project${(deleteNames.length || selectedModels.length) === 1 ? "" : "s"}`;
  const messageTarget = deleteNames.length > 1
    ? `Selected projects: ${deleteNames.slice(0, 4).join(", ")}${deleteNames.length > 4 ? ", ..." : ""}`
    : "This project and its uploaded files will be permanently removed from your workspace.";
  const confirmed = await showConfirmDialog({
    title: `Delete ${titleTarget}?`,
    message: `${messageTarget} This action cannot be undone.`,
    acceptLabel: "Delete",
    danger: true
  });
  if (!confirmed) return;

  if (deleteSelectedButton) deleteSelectedButton.disabled = true;

  try {
    for (const projectId of projectIds) {
      await deleteHostedProject(projectId);
    }

    for (const model of standaloneModels) {
      await deleteHostedFile(model.id);
    }

    activeModels = activeModels.filter((model) => !selectedModels.some((deleted) => deleted.id === model.id));
    if (!activeModels.length) activeModel = null;
    const deletedProjectIds = new Set(projectIds);
    const deletedStandaloneIds = new Set(standaloneModels.map((model) => model.id));
    models = models.filter((model) => !deletedProjectIds.has(model.projectId) && !deletedStandaloneIds.has(model.id));
    selectModelIndexes([]);
    fillModelSelect();
    models = await loadManifest();
    fillModelSelect();
    if (!models.length) showEmptyState();
    else showReadyState();
    showToast("Selected files were deleted.");
  } catch (error) {
    console.error(error);
    showToast(error?.message || "Delete failed");
  } finally {
    refreshDownloadButton();
    if (deleteSelectedButton) deleteSelectedButton.disabled = !currentSession.authenticated || currentModelSource === "share";
  }
}

modelSelect.addEventListener("change", () => {
  if (deleteSelectedButton) {
    deleteSelectedButton.disabled = !getSelectedModelIndexes().length
      || !currentSession.authenticated
      || currentModelSource === "share";
  }

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
deleteSelectedButton?.addEventListener("click", deleteSelectedHostedFiles);
localModelButton.addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", () => {
  const [file] = fileInput.files;
  if (file) loadLocalFile(file);
  fileInput.value = "";
});

shareButton.addEventListener("click", shareDashboard);
profileMenuButton?.addEventListener("click", (event) => {
  event.stopPropagation();
  toggleProfileMenu();
});
profileMenu?.addEventListener("click", (event) => {
  event.stopPropagation();
});
accountAction?.addEventListener("click", async (event) => {
  event.preventDefault();
  await handleAccountAction();
});
themeToggle?.addEventListener("click", () => {
  const nextTheme = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  animateThemeSwap();
  applyTheme(nextTheme);
});
uploadHelpButton.addEventListener("click", () => {
  uploadAwaitingApproval = false;
  refreshUploadControls();
  showUploadPanel();
});
closeUploadPanel.addEventListener("click", hideUploadPanel);
uploadProjectName?.addEventListener("input", refreshUploadControls);
for (const input of uploadFileInputs) {
  input.addEventListener("change", () => {
    const assetType = input.dataset.uploadFileInput;
    const assetLabel = ASSET_TYPE_LABELS[assetType] || "selected data type";
    const files = [...input.files];
    const unsupported = files.find((file) => !isSupportedAssetUploadFile(file, assetType));

    if (unsupported) {
      showToast(`${unsupported.name} is not supported for ${assetLabel}.`);
      input.value = "";
      updateUploadFileSummaries();
      refreshUploadControls();
      return;
    }

    addUploadFiles(assetType, files);
    input.value = "";
    updateUploadFileSummaries();
    refreshUploadControls();
  });
}
for (const input of uploadAssetTypeInputs) {
  input.addEventListener("change", updateUploadTypeVisibility);
}
for (const [assetType, toggle] of uploadFileDetailToggles.entries()) {
  toggle.addEventListener("click", () => {
    const detail = uploadFileDetails.get(assetType);
    if (!detail) return;

    detail.hidden = !detail.hidden;
    const isExpanded = !detail.hidden;
    toggle.dataset.expanded = String(isExpanded);
    toggle.setAttribute("aria-expanded", String(isExpanded));
    toggle.setAttribute("aria-label", `${isExpanded ? "Hide" : "Show"} selected ${ASSET_TYPE_LABELS[assetType]} files`);
  });
}
cloudUploadButton?.addEventListener("click", () => {
  if (uploadAwaitingApproval) {
    hideUploadPanel();
    showReadyState();
    showToast("Upload can finish approval in the background.");
    return;
  }

  uploadSelectedCloudFile();
});
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

window.addEventListener("click", () => {
  hideProfileMenu();
});

window.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    hideProfileMenu();
    hideUploadPanel();
    hideConfirmPanel();
  }
});

applyTheme(window.localStorage.getItem("gaussian-viewer-theme") || "light");
updateUploadTypeVisibility();

async function startDashboard() {
  try {
    showLoading("Preparing viewer", "Looking for self-hosted models...");
    await withTimeout(refreshSession(), 12000, "Session check timed out.");
    models = await withTimeout(loadManifest(), 15000, "Model list check timed out.");
    notifiedPublishedModelIds = getPublishedModelIds(models);
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
