import {
  completeUploadSession,
  createModelShare,
  createUploadSession,
  deleteHostedFile,
  deleteHostedProject,
  getOwnerDownloadUrl,
  getSession,
  getUserModels,
  getUserProjects,
  getViewFileArrayBuffer,
  getViewFileUrl,
  getViewUrls,
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

const SUPPORTED_EXTENSIONS = [".ply", ".splat", ".ksplat", ".spz", ".pcd"];
const UPLOAD_EXTENSIONS_BY_TYPE = {
  mesh_3d: [
    ".obj", ".mtl", ".fbx", ".glb", ".gltf", ".bin", ".stl", ".dae", ".3dm",
    ".jpg", ".jpeg", ".png", ".webp", ".ktx2", ".bmp", ".tga", ".zip"
  ],
  gaussian_splatting: [".ply", ".splat", ".ksplat", ".spz"],
  point_cloud: [".ply", ".las", ".laz", ".pcd", ".xyz", ".pts", ".e57", ".zip"],
  orthomosaic: [".tif", ".tiff", ".geotiff", ".tfw", ".prj", ".zip"]
};
const VIEWABLE_EXTENSIONS_BY_TYPE = {
  mesh_3d: [".glb", ".gltf", ".obj", ".stl"],
  gaussian_splatting: [".ply", ".splat", ".ksplat", ".spz"],
  point_cloud: [".ply", ".pcd"],
  orthomosaic: [".tif", ".tiff", ".geotiff"]
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
const MAX_ORTHO_PREVIEW_DIMENSION = 1536;
const STALLED_LOAD_WARNING_MS = 45000;
const MODEL_REFRESH_INTERVAL_MS = 12000;
let GaussianSplats3D;
let THREE;
let OrbitControls;
let GLTFLoader;
let MTLLoader;
let OBJLoader;
let PCDLoader;
let PLYLoader;
let STLLoader;
let GeoTIFF;
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
const projectTypeSelect = document.querySelector("#project-type-select");
const viewerTypeSwitcher = document.querySelector("#viewer-type-switcher");
const projectDataList = document.querySelector("#project-data-list");
const loadSelectedButton = document.querySelector("#load-selected");
const reloadButton = document.querySelector("#reload-model");
const frameButton = document.querySelector("#frame-model");
const pointModeButton = document.querySelector("#point-mode");
const orthoOrientationPanel = document.querySelector("#ortho-orientation-panel");
const orthoNorthAngleInput = document.querySelector("#ortho-north-angle");
const orthoNorthValue = document.querySelector("#ortho-north-value");
const orthoRotateLeftButton = document.querySelector("#ortho-rotate-left");
const orthoResetNorthButton = document.querySelector("#ortho-reset-north");
const orthoRotateRightButton = document.querySelector("#ortho-rotate-right");
const northIndicator = document.querySelector("#north-indicator");
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
let genericRenderer;
let genericScene;
let genericCamera;
let genericControls;
let genericAnimationFrame = 0;
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
let loadedProjectEntry = null;
let activeViewerAssetType = "gaussian_splatting";
let orthoNorthDegrees = Number(window.localStorage.getItem("gaussian-viewer-ortho-north-degrees") || 0);
if (!Number.isFinite(orthoNorthDegrees)) orthoNorthDegrees = 0;
let loadedOrthoObjects = [];
const signedViewUrlCache = new Map();
let selectedProjectFileIds = new Set();
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

async function loadGenericViewerLibraries() {
  if (THREE && OrbitControls && GLTFLoader && MTLLoader && OBJLoader && PCDLoader && PLYLoader && STLLoader && GeoTIFF) return;

  const [
    threeModule,
    orbitModule,
    gltfModule,
    mtlModule,
    objModule,
    pcdModule,
    plyModule,
    stlModule,
    geotiffModule
  ] = await Promise.all([
    import("three"),
    import("three/addons/controls/OrbitControls.js"),
    import("three/addons/loaders/GLTFLoader.js"),
    import("three/addons/loaders/MTLLoader.js"),
    import("three/addons/loaders/OBJLoader.js"),
    import("three/addons/loaders/PCDLoader.js"),
    import("three/addons/loaders/PLYLoader.js"),
    import("three/addons/loaders/STLLoader.js"),
    import("geotiff")
  ]);

  THREE = threeModule;
  OrbitControls = orbitModule.OrbitControls;
  GLTFLoader = gltfModule.GLTFLoader;
  MTLLoader = mtlModule.MTLLoader;
  OBJLoader = objModule.OBJLoader;
  PCDLoader = pcdModule.PCDLoader;
  PLYLoader = plyModule.PLYLoader;
  STLLoader = stlModule.STLLoader;
  GeoTIFF = geotiffModule;
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
    accountAction.href = "#sign-out";
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
  accountAction.hidden = false;
  accountAction.href = "#sign-in";
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
    cloudUploadButton.classList.add("button-primary");
    cloudUploadButton.classList.remove("button-secondary");
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
  hideViewerTypeSwitcher();
  hideLoading();
  setStatus("Ready for files", "Add hosted models or open a local splat.", "ready");
}

function hideEmptyState() {
  emptyPanel.hidden = true;
}

function showReadyState() {
  emptyPanel.hidden = true;
  readyPanel.hidden = false;
  if (!activeModels.length) hideViewerTypeSwitcher();
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

function disposeGenericViewer() {
  if (genericAnimationFrame) {
    window.cancelAnimationFrame(genericAnimationFrame);
    genericAnimationFrame = 0;
  }

  if (genericScene) {
    genericScene.traverse((object) => {
      object.geometry?.dispose?.();
      const materials = Array.isArray(object.material) ? object.material : [object.material].filter(Boolean);
      for (const material of materials) {
        material.map?.dispose?.();
        material.dispose?.();
      }
    });
  }

  genericControls?.dispose?.();
  genericRenderer?.dispose?.();
  genericRenderer = null;
  genericScene = null;
  genericCamera = null;
  genericControls = null;
}

function clearViewerScene() {
  activeLoadToken += 1;
  clearLoadingWatchdog();
  if (viewer) {
    viewer.dispose();
    viewer = null;
  }
  disposeGenericViewer();
  viewerElement.replaceChildren();
  activeModels = [];
  activeModel = null;
  lastFrame = null;
  pointModeEnabled = false;
  loadedOrthoObjects = [];
  updateOrthoOrientationUI();
  frameButton.disabled = false;
  pointModeButton.disabled = true;
  refreshDownloadButton();
}

function resetViewer() {
  if (!GaussianSplats3D) {
    throw new Error("3D viewer library is not loaded yet.");
  }

  if (viewer) {
    viewer.dispose();
    viewer = null;
  }
  disposeGenericViewer();

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

function setupGenericViewer() {
  disposeGenericViewer();
  viewerElement.replaceChildren();

  genericScene = new THREE.Scene();
  genericScene.background = null;
  genericCamera = new THREE.PerspectiveCamera(
    55,
    Math.max(viewerElement.clientWidth, 1) / Math.max(viewerElement.clientHeight, 1),
    0.01,
    100000
  );
  genericCamera.position.set(3, -4, 2.6);

  genericRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  genericRenderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  genericRenderer.setSize(viewerElement.clientWidth || 800, viewerElement.clientHeight || 500);
  genericRenderer.outputColorSpace = THREE.SRGBColorSpace;
  viewerElement.append(genericRenderer.domElement);

  genericControls = new OrbitControls(genericCamera, genericRenderer.domElement);
  genericControls.enableDamping = true;
  genericControls.dampingFactor = 0.08;
  genericControls.screenSpacePanning = true;

  const ambient = new THREE.HemisphereLight(0xffffff, 0x26352f, 2.2);
  const key = new THREE.DirectionalLight(0xffffff, 2.4);
  key.position.set(4, -6, 7);
  genericScene.add(ambient, key);

  const animate = () => {
    if (!genericRenderer || !genericScene || !genericCamera) return;
    genericControls?.update?.();
    genericRenderer.render(genericScene, genericCamera);
    genericAnimationFrame = window.requestAnimationFrame(animate);
  };
  animate();
}

function resizeGenericViewer() {
  if (!genericRenderer || !genericCamera) return;
  const width = viewerElement.clientWidth || 800;
  const height = viewerElement.clientHeight || 500;
  genericCamera.aspect = width / height;
  genericCamera.updateProjectionMatrix();
  genericRenderer.setSize(width, height);
}

function normalizeDegrees(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return ((((numeric + 180) % 360) + 360) % 360) - 180;
}

function degreesToRadians(degrees) {
  return degrees * Math.PI / 180;
}

function updateNorthIndicator() {
  if (!northIndicator) return;
  const show = activeViewerAssetType === "orthomosaic" && loadedOrthoObjects.length > 0;
  northIndicator.hidden = !show;
  northIndicator.style.setProperty("--north-rotation", `${-orthoNorthDegrees}deg`);
  northIndicator.title = `North orientation: ${Math.round(orthoNorthDegrees)}°`;
}

function updateOrthoOrientationUI() {
  const show = activeViewerAssetType === "orthomosaic";
  if (orthoOrientationPanel) orthoOrientationPanel.hidden = !show;
  if (orthoNorthAngleInput) orthoNorthAngleInput.value = String(Math.round(orthoNorthDegrees));
  if (orthoNorthValue) orthoNorthValue.textContent = `${Math.round(orthoNorthDegrees)}°`;
  updateNorthIndicator();
}

function applyOrthoNorthRotation() {
  const rotation = degreesToRadians(orthoNorthDegrees);
  for (const object of loadedOrthoObjects) {
    object.rotation.z = rotation;
  }
  window.localStorage.setItem("gaussian-viewer-ortho-north-degrees", String(Math.round(orthoNorthDegrees)));
  updateOrthoOrientationUI();
}

function setOrthoNorthDegrees(value) {
  orthoNorthDegrees = normalizeDegrees(value);
  applyOrthoNorthRotation();
  if (genericRenderer && genericScene && genericCamera) {
    genericRenderer.render(genericScene, genericCamera);
  }
}

function fitGenericCameraToScene(assetType = activeViewerAssetType) {
  if (!genericScene || !genericCamera || !genericControls) return;
  const box = new THREE.Box3().setFromObject(genericScene);
  if (box.isEmpty()) return;

  const center = new THREE.Vector3();
  const size = new THREE.Vector3();
  box.getCenter(center);
  box.getSize(size);
  const radius = Math.max(size.length() * 0.55, 1);
  const distance = radius / Math.sin((genericCamera.fov * Math.PI / 180) / 2);

  const offset = assetType === "orthomosaic"
    ? new THREE.Vector3(0, 0, distance * 1.2)
    : new THREE.Vector3(distance * 0.65, -distance, distance * 0.45);

  genericCamera.position.copy(center).add(offset);
  genericCamera.near = Math.max(distance / 1000, 0.01);
  genericCamera.far = Math.max(distance * 20, 1000);
  genericCamera.lookAt(center);
  genericCamera.updateProjectionMatrix();
  genericControls.target.copy(center);
  genericControls.update();
}

function applyCommonObjectStyle(object, model, index, total) {
  object.name = model.name || `Asset ${index + 1}`;
  if (!model.position && total > 1 && model.assetType === "orthomosaic") {
    object.position.x = (index - (total - 1) / 2) * 1.15;
  }
  if (model.assetType === "orthomosaic") {
    object.userData.isOrthomosaic = true;
    object.rotation.z = degreesToRadians(orthoNorthDegrees);
  }
  return object;
}

function getBaseFilename(path = "") {
  try {
    return decodeURIComponent(String(path).split("?")[0].split("#")[0].split("/").pop() || "").toLowerCase();
  } catch {
    return String(path).split("?")[0].split("#")[0].split("/").pop()?.toLowerCase() || "";
  }
}

function getProjectCompanionModels(model, assetType = model?.assetType) {
  if (!model?.projectId) return [];
  return models.filter((candidate) => (
    candidate?.id !== model.id
    && candidate.projectId === model.projectId
    && candidate.assetType === assetType
    && candidate.status === "published"
  ));
}

async function createMeshLoadingManager(model) {
  const companions = getProjectCompanionModels(model, "mesh_3d");
  if (companions.length) {
    await ensureViewUrlsForModels(companions);
  }

  const urlsByFilename = new Map();
  for (const companion of companions) {
    const filename = getBaseFilename(companion.filename || companion.name || companion.path || "");
    if (!filename) continue;
    const url = companion.path
      ? modelPathToUrl(companion.path)
      : getViewFileUrl(companion.id);
    if (url) urlsByFilename.set(filename, url);
  }

  const manager = new THREE.LoadingManager();
  manager.setURLModifier((url) => {
    const filename = getBaseFilename(url);
    return urlsByFilename.get(filename) || url;
  });
  return manager;
}

function findMatchingMaterialFile(model) {
  const modelStem = getBaseFilename(model.filename || model.name || "").replace(/\.[a-z0-9]+$/i, "");
  const companions = getProjectCompanionModels(model, "mesh_3d");
  return companions.find((candidate) => {
    const filename = getBaseFilename(candidate.filename || candidate.name || "");
    if (!filename.endsWith(".mtl")) return false;
    return !modelStem || filename.replace(/\.mtl$/i, "") === modelStem;
  }) || companions.find((candidate) => getBaseFilename(candidate.filename || candidate.name || "").endsWith(".mtl"));
}

async function loadMeshObject(model) {
  const url = modelPathToUrl(model.path);
  const extension = getFileExtension(model.filename || model.path || "");
  const manager = await createMeshLoadingManager(model);

  if (extension === ".glb" || extension === ".gltf") {
    const result = await new GLTFLoader(manager).loadAsync(url);
    return result.scene;
  }

  if (extension === ".obj") {
    const objLoader = new OBJLoader(manager);
    const materialFile = findMatchingMaterialFile(model);
    if (materialFile) {
      await ensureViewUrlsForModels([materialFile]);
      const materialUrl = materialFile.path
        ? modelPathToUrl(materialFile.path)
        : getViewFileUrl(materialFile.id);
      if (materialUrl) {
        const materials = await new MTLLoader(manager).loadAsync(materialUrl);
        materials.preload();
        objLoader.setMaterials(materials);
      }
    }
    return objLoader.loadAsync(url);
  }

  if (extension === ".stl") {
    const geometry = await new STLLoader().loadAsync(url);
    geometry.computeVertexNormals();
    return new THREE.Mesh(
      geometry,
      new THREE.MeshStandardMaterial({
        color: 0xd9e5dc,
        roughness: 0.78,
        metalness: 0.05
      })
    );
  }

  throw new Error(`${extension || "This mesh format"} is stored but not viewable yet.`);
}

async function loadPointCloudObject(model) {
  const url = modelPathToUrl(model.path);
  const extension = getFileExtension(model.filename || model.path || "");

  if (extension === ".pcd") {
    const points = await new PCDLoader().loadAsync(url);
    if (points.material) {
      points.material.size = Math.max(points.material.size || 0.01, 0.015);
      points.material.sizeAttenuation = true;
    }
    return points;
  }

  if (extension === ".ply") {
    const geometry = await new PLYLoader().loadAsync(url);
    geometry.computeBoundingSphere();
    const hasColor = Boolean(geometry.getAttribute("color"));
    return new THREE.Points(
      geometry,
      new THREE.PointsMaterial({
        size: 0.025,
        vertexColors: hasColor,
        color: hasColor ? 0xffffff : 0x83e2a6,
        sizeAttenuation: true
      })
    );
  }

  throw new Error(`${extension || "This point cloud format"} needs conversion before browser viewing.`);
}

function computePreviewSize(width, height, maxDimension = MAX_ORTHO_PREVIEW_DIMENSION) {
  const longest = Math.max(width, height, 1);
  const scale = Math.min(1, maxDimension / longest);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale))
  };
}

async function fetchGeoTiffArrayBuffer(url) {
  const response = await fetch(url, {
    cache: "no-store",
    credentials: "omit"
  });

  if (!response.ok) {
    throw new Error(`Could not fetch GeoTIFF preview file (${response.status}).`);
  }

  return response.arrayBuffer();
}

async function openGeoTiff(model, url) {
  let arrayBuffer;

  try {
    arrayBuffer = await fetchGeoTiffArrayBuffer(url);
  } catch (directError) {
    if (!isBackendEnabled() || !model?.id) throw directError;
    arrayBuffer = await getViewFileArrayBuffer(model.id);
  }

  if (!arrayBuffer?.byteLength) {
    throw new Error("GeoTIFF preview file is empty.");
  }

  return GeoTIFF.fromArrayBuffer(arrayBuffer);
}

function normalizeRasterValue(value, min, max) {
  if (!Number.isFinite(value)) return 0;
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) {
    return Math.max(0, Math.min(255, Math.round(value)));
  }
  return Math.max(0, Math.min(255, Math.round(((value - min) / (max - min)) * 255)));
}

function findRasterRange(raster, bandCount, bandOffset) {
  let min = Infinity;
  let max = -Infinity;
  const pixelCount = Math.max(1, Math.floor(raster.length / Math.max(bandCount, 1)));
  const step = Math.max(1, Math.floor(pixelCount / 100000));

  for (let pixel = 0; pixel < pixelCount; pixel += step) {
    const value = Number(raster[pixel * bandCount + bandOffset]);
    if (!Number.isFinite(value)) continue;
    if (value < min) min = value;
    if (value > max) max = value;
  }

  return { min, max };
}

function rasterToTexture(raster, width, height, samplesPerPixel) {
  const bandCount = Math.max(1, Math.min(samplesPerPixel || 1, 4));
  const visibleBands = Math.min(bandCount, 3);
  const ranges = Array.from({ length: visibleBands }, (_, band) => findRasterRange(raster, bandCount, band));
  const rgba = new Uint8Array(width * height * 4);

  for (let pixel = 0; pixel < width * height; pixel += 1) {
    const sourceOffset = pixel * bandCount;
    const targetOffset = pixel * 4;

    if (bandCount >= 3) {
      rgba[targetOffset] = normalizeRasterValue(raster[sourceOffset], ranges[0].min, ranges[0].max);
      rgba[targetOffset + 1] = normalizeRasterValue(raster[sourceOffset + 1], ranges[1].min, ranges[1].max);
      rgba[targetOffset + 2] = normalizeRasterValue(raster[sourceOffset + 2], ranges[2].min, ranges[2].max);
    } else {
      const gray = normalizeRasterValue(raster[sourceOffset], ranges[0].min, ranges[0].max);
      rgba[targetOffset] = gray;
      rgba[targetOffset + 1] = gray;
      rgba[targetOffset + 2] = gray;
    }

    rgba[targetOffset + 3] = bandCount >= 4
      ? normalizeRasterValue(raster[sourceOffset + 3], 0, 255)
      : 255;
  }

  const texture = new THREE.DataTexture(rgba, width, height, THREE.RGBAFormat, THREE.UnsignedByteType);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

async function loadOrthoObject(model) {
  const extension = getFileExtension(model.filename || model.path || "");
  if (!VIEWABLE_EXTENSIONS_BY_TYPE.orthomosaic.includes(extension)) {
    throw new Error(`${extension || "This ortho format"} needs tile conversion before browser viewing.`);
  }

  try {
    const tiff = await openGeoTiff(model, modelPathToUrl(model.path));
    const image = await tiff.getImage();
    const sourceWidth = image.getWidth();
    const sourceHeight = image.getHeight();
    const sampleCount = Math.max(1, Math.min(image.getSamplesPerPixel?.() || 1, 4));
    const previewSize = computePreviewSize(sourceWidth, sourceHeight);
    const raster = await image.readRasters({
      width: previewSize.width,
      height: previewSize.height,
      samples: Array.from({ length: sampleCount }, (_, index) => index),
      interleave: true
    });
    const texture = rasterToTexture(raster, previewSize.width, previewSize.height, sampleCount);
    const aspect = sourceWidth && sourceHeight
      ? sourceWidth / sourceHeight
      : previewSize.width / previewSize.height;
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(aspect, 1),
      new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide })
    );
    mesh.userData.orthoSourceWidth = sourceWidth;
    mesh.userData.orthoSourceHeight = sourceHeight;
    mesh.userData.orthoPreviewWidth = previewSize.width;
    mesh.userData.orthoPreviewHeight = previewSize.height;
    return mesh;
  } catch (error) {
    const reason = error?.message || "Convert it to web map tiles or a Cloud Optimized GeoTIFF preview.";
    const fetchHint = /failed to fetch|networkerror|cors/i.test(reason)
      ? " The file URL may be expired or blocked by storage CORS."
      : "";
    throw new Error(`This GeoTIFF could not be previewed in the browser. ${reason}${fetchHint}`);
  }
}

async function loadGenericAssetObject(model, index, total) {
  const assetType = model.assetType || "mesh_3d";
  const object = assetType === "mesh_3d"
    ? await loadMeshObject(model)
    : assetType === "point_cloud"
      ? await loadPointCloudObject(model)
      : await loadOrthoObject(model);

  return applyCommonObjectStyle(object, model, index, total);
}

function getLoadedSplatCount() {
  return viewer?.getSplatMesh?.()?.getSplatCount?.() ?? 0;
}

function updateModelInfo(model = activeModel, frame = lastFrame) {
  if (activeViewerAssetType !== "gaussian_splatting") {
    const typeLabel = ASSET_TYPE_LABELS[activeViewerAssetType] || "Data";
    const infoParts = [
      model?.name || getModelDisplayName(activeModels) || "Loaded data",
      typeLabel
    ];
    if (activeModels.length > 1) infoParts.push(`${activeModels.length} files`);
    if (activeViewerAssetType === "orthomosaic") infoParts.push(`north ${Math.round(orthoNorthDegrees)}°`);
    modelInfo.textContent = infoParts.join(" · ");
    modelInfo.hidden = false;
    refreshDownloadButton();
    return;
  }

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
      const extension = getFileExtension(filename || path || "");
      const progressiveDefault = extension === ".splat" || extension === ".ksplat";
      const normalizedAssetType = model.assetType || "gaussian_splatting";
      const normalizedModel = {
        path,
        filename,
        status: model.status || "published",
        assetType: normalizedAssetType,
        needsViewUrl: Boolean(model.needsViewUrl)
      };

      return {
        id: model.id || model.modelId || model.slug || slugify(name || path),
        name,
        displayName: model.projectName ? `${model.projectName} — ${name}` : name,
        slug: model.slug || slugify(name || path),
        path,
        needsViewUrl: Boolean(model.needsViewUrl),
        filename,
        size: model.size,
        format: model.format,
        projectId: model.projectId,
        projectName: model.projectName,
        projectSlug: model.projectSlug,
        projectTotalAssets: model.projectTotalAssets,
        projectApprovedAssets: model.projectApprovedAssets,
        assetType: normalizedAssetType,
        assetTypeLabel: model.assetTypeLabel || ASSET_TYPE_LABELS[normalizedAssetType] || "Gaussian Splatting",
        status: normalizedModel.status,
        canLoad: model.canLoad === false ? false : isBrowserViewableAsset(normalizedModel),
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

function getFileExtension(path) {
  const cleanPath = path.split("?")[0].split("#")[0].toLowerCase();
  const filename = cleanPath.split("/").pop() || cleanPath;
  const match = filename.match(/\.[a-z0-9]+$/i);
  return match ? match[0] : "";
}

function getExtensionFromPath(path) {
  const extension = getFileExtension(path);
  return SUPPORTED_EXTENSIONS.includes(extension) ? extension : undefined;
}

function isBrowserViewableAsset(model) {
  if (!model || model.status !== "published" || (!model.path && !model.needsViewUrl)) return false;
  const assetType = model.assetType || "gaussian_splatting";
  const extension = getFileExtension(model.filename || model.path || "");
  return Boolean((VIEWABLE_EXTENSIONS_BY_TYPE[assetType] || []).includes(extension));
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
        canLoad: Boolean(asset.canLoad && isBrowserViewableAsset(asset))
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

function getAssetTypeOrder() {
  return Object.keys(ASSET_TYPE_LABELS);
}

function appendTextElement(parent, tagName, className, text) {
  const element = document.createElement(tagName);
  if (className) element.className = className;
  element.textContent = text;
  parent.append(element);
  return element;
}

function getProjectTypeStats(entry) {
  const stats = new Map();

  for (const assetType of getAssetTypeOrder()) {
    stats.set(assetType, {
      assetType,
      label: ASSET_TYPE_LABELS[assetType] || assetType,
      total: 0,
      approved: 0,
      loadable: 0
    });
  }

  for (const index of entry?.indexes || []) {
    const model = models[index];
    if (!model) continue;
    const assetType = model.assetType || "gaussian_splatting";
    if (!stats.has(assetType)) {
      stats.set(assetType, {
        assetType,
        label: ASSET_TYPE_LABELS[assetType] || assetType,
        total: 0,
        approved: 0,
        loadable: 0
      });
    }
    const item = stats.get(assetType);
    item.total += 1;
    if (model.status === "published") item.approved += 1;
    if (model.canLoad && model.path) item.loadable += 1;
  }

  return [...stats.values()].filter((item) => item.total > 0);
}

function getSelectedAssetType() {
  return projectTypeSelect?.value || "all";
}

function fillProjectTypeSelect() {
  if (!projectTypeSelect) return;

  const selectedEntries = getSelectedProjectEntries();
  projectTypeSelect.replaceChildren();

  if (!selectedEntries.length) {
    const option = document.createElement("option");
    option.textContent = "Choose a project first";
    projectTypeSelect.append(option);
    projectTypeSelect.disabled = true;
    return;
  }

  const previousValue = projectTypeSelect.value;
  const combined = new Map();
  for (const entry of selectedEntries) {
    for (const stat of getProjectTypeStats(entry)) {
      if (!combined.has(stat.assetType)) {
        combined.set(stat.assetType, { ...stat, total: 0, approved: 0, loadable: 0 });
      }
      const item = combined.get(stat.assetType);
      item.total += stat.total;
      item.approved += stat.approved;
      item.loadable += stat.loadable;
    }
  }

  const allOption = document.createElement("option");
  allOption.value = "all";
  allOption.textContent = "All viewable files";
  projectTypeSelect.append(allOption);

  for (const assetType of getAssetTypeOrder()) {
    const stat = combined.get(assetType);
    if (!stat) continue;
    const option = document.createElement("option");
    option.value = assetType;
    option.textContent = `${stat.label} — ${stat.approved}/${stat.total} approved`;
    projectTypeSelect.append(option);
  }

  const values = new Set([...projectTypeSelect.options].map((option) => option.value));
  projectTypeSelect.value = values.has(previousValue)
    ? previousValue
    : (values.has("gaussian_splatting") ? "gaussian_splatting" : "all");
  projectTypeSelect.disabled = false;
}

function clearSelectedProjectFiles() {
  selectedProjectFileIds = new Set();
}

function getModelStableId(model, index) {
  return model?.id || `${model?.projectId || "project"}:${model?.filename || model?.name || index}`;
}

function renderProjectDataList() {
  if (!projectDataList) return;

  const selectedEntries = getSelectedProjectEntries();
  projectDataList.replaceChildren();

  if (!selectedEntries.length) {
    projectDataList.hidden = true;
    return;
  }

  const selectedIndexes = [...new Set(selectedEntries.flatMap((entry) => entry.indexes))];
  const grouped = new Map();

  for (const index of selectedIndexes) {
    const model = models[index];
    if (!model) continue;
    const assetType = model.assetType || "gaussian_splatting";
    if (!grouped.has(assetType)) grouped.set(assetType, []);
    grouped.get(assetType).push({ model, index });
  }

  for (const assetType of getAssetTypeOrder()) {
    const files = grouped.get(assetType) || [];
    if (!files.length) continue;

    const typeCard = document.createElement("section");
    typeCard.className = "project-data-type";
    typeCard.dataset.assetType = assetType;

    const approvedCount = files.filter(({ model }) => model.status === "published").length;
    const viewableCount = files.filter(({ model }) => model.canLoad).length;
    const header = document.createElement("button");
    header.type = "button";
    header.className = "project-data-type-header";
    header.dataset.active = String(getSelectedAssetType() === assetType);
    appendTextElement(header, "span", "", ASSET_TYPE_LABELS[assetType] || assetType);
    appendTextElement(header, "small", "", `${approvedCount}/${files.length} approved · ${viewableCount} viewable`);
    header.addEventListener("click", () => {
      if (projectTypeSelect) projectTypeSelect.value = assetType;
      clearSelectedProjectFiles();
      renderProjectDataList();
    });

    const list = document.createElement("div");
    list.className = "project-file-list";

    for (const { model, index } of files) {
      const fileId = getModelStableId(model, index);
      const extension = getFileExtension(model.filename || model.name || "");
      const isSelected = selectedProjectFileIds.has(fileId);
      const fileButton = document.createElement("button");
      fileButton.type = "button";
      fileButton.className = "project-file-row";
      fileButton.dataset.selected = String(isSelected);
      fileButton.dataset.status = model.status || "published";
      fileButton.disabled = !model.canLoad;
      appendTextElement(fileButton, "span", "project-file-name", model.name || model.filename || "Untitled file");
      appendTextElement(
        fileButton,
        "span",
        "project-file-meta",
        `${extension || "file"} · ${model.status || "published"}${model.size ? ` · ${formatBytes(model.size)}` : ""}`
      );
      fileButton.addEventListener("click", () => {
        if (projectTypeSelect) projectTypeSelect.value = assetType;
        if (selectedProjectFileIds.has(fileId)) selectedProjectFileIds.delete(fileId);
        else selectedProjectFileIds.add(fileId);
        renderProjectDataList();
      });
      list.append(fileButton);
    }

    typeCard.append(header, list);
    projectDataList.append(typeCard);
  }

  projectDataList.hidden = projectDataList.childElementCount === 0;
}

function hideViewerTypeSwitcher() {
  if (!viewerTypeSwitcher) return;
  viewerTypeSwitcher.hidden = true;
  viewerTypeSwitcher.replaceChildren();
}

function renderViewerTypeSwitcher(entry, activeAssetType = "gaussian_splatting") {
  if (!viewerTypeSwitcher) return;
  viewerTypeSwitcher.replaceChildren();

  const stats = getProjectTypeStats(entry);
  if (!stats.length) {
    hideViewerTypeSwitcher();
    return;
  }

  for (const stat of stats) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "viewer-type-pill";
    button.dataset.assetType = stat.assetType;
    button.dataset.active = String(stat.assetType === activeAssetType);
    appendTextElement(button, "span", "", stat.label);
    appendTextElement(button, "small", "", `${stat.approved}/${stat.total}`);
    button.addEventListener("click", async () => {
      if (activeViewerAssetType === stat.assetType) return;
      activeViewerAssetType = stat.assetType;
      if (projectTypeSelect) projectTypeSelect.value = stat.assetType;
      renderViewerTypeSwitcher(entry, stat.assetType);
      await loadSelectedHostedModels();
    });
    viewerTypeSwitcher.append(button);
  }

  viewerTypeSwitcher.hidden = false;
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
    fillProjectTypeSelect();
    renderProjectDataList();
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
  fillProjectTypeSelect();
  renderProjectDataList();
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
  const selectedFileIds = selectedProjectFileIds;
  const selectedAssetType = getSelectedAssetType();
  return [...modelSelect.selectedOptions]
    .map((option) => Number(option.value))
    .filter((index) => Number.isInteger(index) && modelSelectEntries[index])
    .flatMap((entryIndex) => modelSelectEntries[entryIndex].indexes)
    .filter((index) => {
      const model = models[index];
      if (!model) return false;
      if (selectedFileIds.size) return selectedFileIds.has(getModelStableId(model, index));
      return Number.isInteger(index)
        && (selectedAssetType === "all" || model.assetType === selectedAssetType);
    });
}

function getSelectedProjectEntries() {
  return [...modelSelect.selectedOptions]
    .map((option) => modelSelectEntries[Number(option.value)])
    .filter(Boolean);
}

function getCombinedSelectedProjectEntry() {
  const entries = getSelectedProjectEntries();
  if (!entries.length) return null;
  if (entries.length === 1) return entries[0];

  const indexes = [...new Set(entries.flatMap((entry) => entry.indexes))];
  return {
    label: `${entries.length} selected projects`,
    indexes,
    totalAssets: entries.reduce((sum, entry) => sum + Number(entry.totalAssets || 0), 0),
    approvedAssets: entries.reduce((sum, entry) => sum + Number(entry.approvedAssets || 0), 0)
  };
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

function startEstimatedProgress({ token, from = 0, to = 95, label = "Loading", markProgress = () => {} } = {}) {
  let current = Math.max(0, Math.min(100, from));
  const ceiling = Math.max(current, Math.min(99, to));
  setModelLoadProgress(current);
  markProgress(`${label} ${Math.round(current)}%`);

  const timer = window.setInterval(() => {
    if (token !== activeLoadToken) {
      window.clearInterval(timer);
      return;
    }

    const remaining = ceiling - current;
    if (remaining <= 0.4) return;
    current += Math.max(0.25, remaining * 0.08);
    setModelLoadProgress(current);
    markProgress(`${label} ${Math.round(current)}%`);
  }, 450);

  return (finalPercent = ceiling) => {
    window.clearInterval(timer);
    current = Math.max(current, Math.min(100, finalPercent));
    setModelLoadProgress(current);
    markProgress(`${label} ${Math.round(current)}%`);
  };
}

async function loadModel(model, sourceUrl = model.path) {
  activeModel = model;
  activeModels = [model];
  loadedOrthoObjects = [];
  updateOrthoOrientationUI();
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
    loadedOrthoObjects = [];
    updateOrthoOrientationUI();
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
  loadedProjectEntry = getCombinedSelectedProjectEntry();
  activeViewerAssetType = model.assetType || "gaussian_splatting";
  await ensureViewUrlsForModels([model]);
  if (activeViewerAssetType === "gaussian_splatting") {
    await loadModel(model, modelPathToUrl(model.path));
  } else {
    await loadGenericDataModels([model], activeViewerAssetType);
  }
  if (loadedProjectEntry) renderViewerTypeSwitcher(loadedProjectEntry, activeViewerAssetType);
  updateShareUrl(model);
}

async function ensureViewUrlsForModels(selectedModels) {
  const missingModels = selectedModels.filter((model) => model?.status === "published" && !model.path && model.needsViewUrl);
  if (!missingModels.length) return selectedModels;

  const missingIds = missingModels
    .map((model) => model.id)
    .filter((id) => id && !signedViewUrlCache.has(id));

  if (missingIds.length) {
    const payload = await getViewUrls(missingIds);
    for (const signedModel of payload?.models || []) {
      if (signedModel.id && signedModel.path) signedViewUrlCache.set(signedModel.id, signedModel.path);
    }
  }

  for (const model of missingModels) {
    const signedPath = signedViewUrlCache.get(model.id);
    if (signedPath) {
      model.path = signedPath;
      model.needsViewUrl = false;
    }
  }

  const stillMissing = missingModels.filter((model) => !model.path);
  if (stillMissing.length) {
    throw new Error(`Could not prepare ${stillMissing.length} selected file${stillMissing.length === 1 ? "" : "s"} for viewing.`);
  }

  return selectedModels;
}

async function loadGenericDataModels(selectedModels, assetType) {
  activeViewerAssetType = assetType;
  updateOrthoOrientationUI();
  activeModels = selectedModels;
  activeModel = {
    name: getModelDisplayName(selectedModels),
    size: getTotalModelSize(selectedModels),
    assetType
  };

  const loadToken = ++activeLoadToken;
  const typeLabel = ASSET_TYPE_LABELS[assetType] || "Data";
  const sizeHint = activeModel.size ? ` • ${formatBytes(activeModel.size)}` : "";
  hideEmptyState();
  hideReadyState();
  showLoading(`Loading ${typeLabel}`, `${activeModel.name}${sizeHint}`);
  setModelLoadProgress(2);
  const markProgress = startLoadingWatchdog(activeModel, loadToken);
  markProgress("Preparing viewer libraries 2%");

  try {
    await loadGenericViewerLibraries();
    if (loadToken !== activeLoadToken) return;
    setupGenericViewer();
    loadedOrthoObjects = [];
    updateOrthoOrientationUI();
    frameButton.disabled = false;
    pointModeButton.disabled = true;
    modelInfo.hidden = true;
    lastFrame = null;
    pointModeEnabled = false;

    for (const [index, model] of selectedModels.entries()) {
      if (loadToken !== activeLoadToken) return;
      const percent = Math.round((index / Math.max(selectedModels.length, 1)) * 100);
      const nextPercent = Math.round(((index + 1) / Math.max(selectedModels.length, 1)) * 100);
      const detail = `Reading ${index + 1}/${selectedModels.length} • ${model.name}`;
      setModelLoadProgress(percent);
      markProgress(detail);
      setStatus(`Loading ${typeLabel}`, detail, "loading");
      const stopEstimatedProgress = startEstimatedProgress({
        token: loadToken,
        from: percent,
        to: Math.max(percent, nextPercent - 3),
        label: detail,
        markProgress
      });
      let object;
      try {
        object = await loadGenericAssetObject(model, index, selectedModels.length);
      } finally {
        stopEstimatedProgress(nextPercent);
      }
      genericScene.add(object);
      if (object.userData?.isOrthomosaic) loadedOrthoObjects.push(object);
    }

    if (loadToken !== activeLoadToken) return;
    setModelLoadProgress(100);
    applyOrthoNorthRotation();
    resizeGenericViewer();
    fitGenericCameraToScene(assetType);
    updateModelInfo(activeModel);
    setStatus("Live", `${activeModel.name} • ${typeLabel}`, "ready");
    updateShareUrl(selectedModels);
    if (loadedProjectEntry) renderViewerTypeSwitcher(loadedProjectEntry, activeViewerAssetType);
    hideLoading();
  } catch (error) {
    if (loadToken !== activeLoadToken) return;
    clearLoadingWatchdog();
    console.error(error);
    loadingPanel.classList.add("is-error");
    setStatus(
      `${typeLabel} failed`,
      error?.message || "This file may need conversion before browser viewing.",
      "error"
    );
    showToast(error?.message || `Could not load ${typeLabel}.`);
  } finally {
    refreshDownloadButton();
  }
}

async function loadSelectedHostedModels() {
  cleanObjectUrl();
  const selectedEntry = getCombinedSelectedProjectEntry();
  const selectedAssetType = getSelectedAssetType();
  const indexes = getSelectedModelIndexes();
  const hasSpecificFileSelection = selectedProjectFileIds.size > 0;
  const firstSelectedModel = indexes.map((index) => models[index]).find(Boolean);
  const renderAssetType = hasSpecificFileSelection
    ? (firstSelectedModel?.assetType || "gaussian_splatting")
    : (selectedAssetType === "all" ? "gaussian_splatting" : selectedAssetType);
  const typedIndexes = indexes.filter((index) => {
    const model = models[index];
    if (hasSpecificFileSelection) return true;
    return selectedAssetType === "all"
      ? model?.assetType === "gaussian_splatting"
      : model?.assetType === selectedAssetType;
  });
  const loadableIndexes = typedIndexes.filter((index) => models[index]?.canLoad);
  const selectedModels = loadableIndexes
    .map((index) => models[index])
    .filter((model) => model?.canLoad);

  if (!selectedModels.length) {
    loadedProjectEntry = selectedEntry;
    activeViewerAssetType = renderAssetType;
    clearViewerScene();
    showReadyState();
    if (loadedProjectEntry) renderViewerTypeSwitcher(loadedProjectEntry, activeViewerAssetType);
    const typeLabel = ASSET_TYPE_LABELS[renderAssetType] || "selected data";
    const hasTypedFiles = typedIndexes.length > 0;
    const hasApprovedTypedFiles = typedIndexes.some((index) => models[index]?.status === "published");
    if (renderAssetType !== "gaussian_splatting" && hasApprovedTypedFiles) {
      showToast(`${typeLabel} is stored in this project. Viewer support for this type is coming next.`);
    } else if (hasTypedFiles) {
      showToast(`${typeLabel} has no approved viewable files yet.`);
    } else {
      showToast(hasSpecificFileSelection ? "Selected files are not viewable yet." : `This project has no ${typeLabel} files.`);
    }
    return;
  }

  loadedProjectEntry = selectedEntry;
  activeViewerAssetType = renderAssetType;
  await ensureViewUrlsForModels(selectedModels);

  if (renderAssetType !== "gaussian_splatting") {
    await loadGenericDataModels(selectedModels, renderAssetType);
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
    loadedOrthoObjects = [];
    updateOrthoOrientationUI();
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
    if (loadedProjectEntry) renderViewerTypeSwitcher(loadedProjectEntry, activeViewerAssetType);
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
    showToast("Use .ply, .splat, .ksplat, .spz, or .pcd");
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
  loadedProjectEntry = null;
  hideViewerTypeSwitcher();
  activeObjectUrl = URL.createObjectURL(file);
  if (extension === ".pcd") {
    await loadGenericDataModels([
      {
        id: `local:${file.name}`,
        name: file.name,
        path: activeObjectUrl,
        filename: file.name,
        size: file.size,
        status: "published",
        canLoad: true,
        assetType: "point_cloud"
      }
    ], "point_cloud");
    return;
  }

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
    const shareModels = activeViewerAssetType === "mesh_3d"
      ? [
        ...activeModels,
        ...activeModels.flatMap((model) => getProjectCompanionModels(model, "mesh_3d"))
      ]
      : activeModels;
    const modelIds = [...new Set(shareModels.map((model) => model.id || model.slug).filter(Boolean))];
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
  clearSelectedProjectFiles();
  fillProjectTypeSelect();
  renderProjectDataList();

  if (deleteSelectedButton) {
    deleteSelectedButton.disabled = !getSelectedProjectEntries().length
      || !currentSession.authenticated
      || currentModelSource === "share";
  }

  if (!getSelectedModelIndexes().length) {
    showReadyState();
  }
});

projectTypeSelect?.addEventListener("change", () => {
  clearSelectedProjectFiles();
  renderProjectDataList();

  if (deleteSelectedButton) {
    deleteSelectedButton.disabled = !getSelectedProjectEntries().length
      || !currentSession.authenticated
      || currentModelSource === "share";
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

orthoNorthAngleInput?.addEventListener("input", () => {
  setOrthoNorthDegrees(orthoNorthAngleInput.value);
  updateModelInfo(activeModel);
});

orthoRotateLeftButton?.addEventListener("click", () => {
  setOrthoNorthDegrees(orthoNorthDegrees - 5);
  updateModelInfo(activeModel);
});

orthoResetNorthButton?.addEventListener("click", () => {
  setOrthoNorthDegrees(0);
  updateModelInfo(activeModel);
  showToast("Orthomosaic reset to north-up.");
});

northIndicator?.addEventListener("click", () => {
  setOrthoNorthDegrees(0);
  updateModelInfo(activeModel);
  showToast("Orthomosaic reset to north-up.");
});

orthoRotateRightButton?.addEventListener("click", () => {
  setOrthoNorthDegrees(orthoNorthDegrees + 5);
  updateModelInfo(activeModel);
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

window.addEventListener("resize", resizeGenericViewer, { passive: true });

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
