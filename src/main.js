import * as GaussianSplats3D from "@mkkellogg/gaussian-splats-3d";
import * as THREE from "three";
import "./style.css";

const MANIFEST_URL = `${import.meta.env.BASE_URL}models/manifest.json`;
const SUPPORTED_EXTENSIONS = [".ply", ".splat", ".ksplat", ".spz"];
const MAX_LOCAL_PREVIEW_BYTES = 350 * 1024 * 1024;
const MAX_LOCAL_PLY_PREVIEW_BYTES = 150 * 1024 * 1024;
const SCENE_FORMAT_BY_EXTENSION = {
  ".ply": GaussianSplats3D.SceneFormat.Ply,
  ".splat": GaussianSplats3D.SceneFormat.Splat,
  ".ksplat": GaussianSplats3D.SceneFormat.KSplat,
  ".spz": GaussianSplats3D.SceneFormat.Spz
};

const connectionLabel = document.querySelector("#connection-label");
const loadingPanel = document.querySelector("#loading-panel");
const loadingTitle = document.querySelector("#loading-title");
const loadingDetail = document.querySelector("#loading-detail");
const emptyPanel = document.querySelector("#empty-panel");
const readyPanel = document.querySelector("#ready-panel");
const viewerElement = document.querySelector("#viewer");
const modelSelect = document.querySelector("#model-select");
const reloadButton = document.querySelector("#reload-model");
const frameButton = document.querySelector("#frame-model");
const pointModeButton = document.querySelector("#point-mode");
const localModelButton = document.querySelector("#local-model");
const fileInput = document.querySelector("#file-input");
const shareButton = document.querySelector("#share-button");
const uploadHelpButton = document.querySelector("#upload-help-button");
const uploadPanel = document.querySelector("#upload-panel");
const closeUploadPanel = document.querySelector("#close-upload-panel");
const toast = document.querySelector("#toast");
const dropZone = document.querySelector("#drop-zone");
const modelInfo = document.querySelector("#model-info");

let viewer;
let models = [];
let activeModel = null;
let activeObjectUrl = null;
let lastFrame = null;
let pointModeEnabled = false;

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function updateShareUrl(model) {
  if (!model || activeObjectUrl) return;

  const url = new URL(window.location.href);
  url.searchParams.set("model", model.slug || slugify(model.name));
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

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("is-visible");
  window.setTimeout(() => toast.classList.remove("is-visible"), 2400);
}

function showUploadPanel() {
  uploadPanel.hidden = false;
}

function hideUploadPanel() {
  uploadPanel.hidden = true;
}

function showLoading(title, detail) {
  loadingPanel.hidden = false;
  loadingPanel.classList.remove("is-error", "is-complete");
  setStatus(title, detail);
}

function hideLoading() {
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

function updateModelInfo(model, frame = lastFrame) {
  const splatCount = frame?.splatCount ?? getLoadedSplatCount();
  const radius = frame?.radius;
  const infoParts = [
    model?.name || "Loaded model",
    `${splatCount.toLocaleString()} splats`
  ];

  if (Number.isFinite(radius)) infoParts.push(`radius ${radius.toFixed(2)}`);
  if (pointModeEnabled) infoParts.push("point mode");

  modelInfo.textContent = infoParts.join(" · ");
  modelInfo.hidden = false;
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
  const units = ["B", "MB", "GB"];
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
          name,
          slug: slugify(name),
          path: model
        };
      }

      const name = model.name || model.title || `Model ${index + 1}`;
      return {
        name,
        slug: model.slug || slugify(name || model.path || model.url),
        path: model.path || model.url,
        format: model.format,
        position: model.position,
        rotation: model.rotation,
        scale: model.scale,
        alphaThreshold: model.alphaThreshold ?? model.splatAlphaRemovalThreshold ?? 0,
        progressiveLoad: model.progressiveLoad ?? false
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
  return extension ? SCENE_FORMAT_BY_EXTENSION[extension] : undefined;
}

function fillModelSelect() {
  modelSelect.replaceChildren();

  if (!models.length) {
    const option = document.createElement("option");
    option.textContent = "No hosted models";
    modelSelect.append(option);
    modelSelect.disabled = true;
    reloadButton.disabled = true;
    frameButton.disabled = false;
    pointModeButton.disabled = true;
    return;
  }

  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "Choose hosted model";
  modelSelect.append(placeholder);

  for (const [index, model] of models.entries()) {
    const option = document.createElement("option");
    option.value = String(index);
    option.textContent = model.name;
    modelSelect.append(option);
  }

  modelSelect.disabled = false;
  reloadButton.disabled = false;
  frameButton.disabled = false;
  pointModeButton.disabled = true;
}

async function loadManifest() {
  try {
    const response = await fetch(MANIFEST_URL, { cache: "no-store" });
    if (!response.ok) return [];
    return normalizeManifest(await response.json());
  } catch {
    return [];
  }
}

async function loadModel(model, sourceUrl = model.path) {
  activeModel = model;
  hideEmptyState();
  hideReadyState();
  showLoading("Loading model", model.name);

  try {
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

    await viewer.addSplatScene(sourceUrl, {
      format,
      splatAlphaRemovalThreshold: model.alphaThreshold ?? 0,
      showLoadingUI: true,
      progressiveLoad: model.progressiveLoad ?? false,
      position: model.position ?? [0, 0, 0],
      rotation: model.rotation ?? [0, 0, 0, 1],
      scale: model.scale ?? [1, 1, 1]
    });

    viewer.start();
    window.setTimeout(() => {
      const splatCount = getLoadedSplatCount();
      updateModelInfo(model);
      pointModeButton.disabled = splatCount <= 0;
      frameButton.disabled = false;
      setPointMode(true);
      if (!frameModel()) showToast("Model loaded, but no frameable splats were found.");
    }, 100);
    setStatus("Live", model.name, "ready");
    hideLoading();
  } catch (error) {
    console.error(error);
    loadingPanel.classList.add("is-error");
    setStatus(
      "Model failed",
      error?.message || "Check the file path, format, size, and browser console.",
      "error"
    );
    showToast(error?.message || "Could not load model");
  }
}

async function loadHostedModel(index) {
  cleanObjectUrl();
  const model = models[index];
  if (!model) return;
  await loadModel(model, modelPathToUrl(model.path));
  updateShareUrl(model);
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

async function shareDashboard() {
  const shareUrl = getShareUrl();
  if (!shareUrl) {
    showToast("Submit this model for approval before sharing.");
    showUploadPanel();
    return;
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

modelSelect.addEventListener("change", () => {
  if (modelSelect.value === "") {
    showReadyState();
    return;
  }

  loadHostedModel(Number(modelSelect.value));
});

reloadButton.addEventListener("click", () => {
  if (activeObjectUrl && activeModel) {
    loadModel(activeModel, activeObjectUrl);
    return;
  }

  loadHostedModel(Number(modelSelect.value));
});

frameButton.addEventListener("click", () => {
  if (!frameModel()) showToast("Could not frame this model");
});

pointModeButton.addEventListener("click", () => {
  if (!setPointMode(!pointModeEnabled)) showToast("Point mode is not available yet");
});

localModelButton.addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", () => {
  const [file] = fileInput.files;
  if (file) loadLocalFile(file);
  fileInput.value = "";
});

shareButton.addEventListener("click", shareDashboard);
uploadHelpButton.addEventListener("click", showUploadPanel);
closeUploadPanel.addEventListener("click", hideUploadPanel);
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

async function startDashboard() {
  showLoading("Preparing viewer", "Looking for self-hosted models...");
  models = await loadManifest();
  fillModelSelect();

  if (!models.length) {
    showEmptyState();
    return;
  }

  const requestedModel = new URLSearchParams(window.location.search).get("model");
  if (!requestedModel) {
    modelSelect.value = "";
    showReadyState();
    return;
  }

  const requestedIndex = models.findIndex((model) => {
    const slug = model.slug || slugify(model.name);
    return slug === requestedModel || model.name === requestedModel;
  });

  if (requestedIndex < 0) {
    modelSelect.value = "";
    showReadyState();
    showToast("Shared model was not found.");
    return;
  }

  modelSelect.value = String(requestedIndex);
  await loadHostedModel(requestedIndex);
}

startDashboard();
