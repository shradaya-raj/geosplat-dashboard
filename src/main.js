import * as GaussianSplats3D from "@mkkellogg/gaussian-splats-3d";
import "./style.css";

const MANIFEST_URL = `${import.meta.env.BASE_URL}models/manifest.json`;
const SUPPORTED_EXTENSIONS = [".ply", ".splat", ".ksplat"];

const connectionLabel = document.querySelector("#connection-label");
const loadingPanel = document.querySelector("#loading-panel");
const loadingTitle = document.querySelector("#loading-title");
const loadingDetail = document.querySelector("#loading-detail");
const emptyPanel = document.querySelector("#empty-panel");
const viewerElement = document.querySelector("#viewer");
const modelSelect = document.querySelector("#model-select");
const reloadButton = document.querySelector("#reload-model");
const localModelButton = document.querySelector("#local-model");
const fileInput = document.querySelector("#file-input");
const shareButton = document.querySelector("#share-button");
const toast = document.querySelector("#toast");
const dropZone = document.querySelector("#drop-zone");

let viewer;
let models = [];
let activeModel = null;
let activeObjectUrl = null;

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
  emptyPanel.hidden = false;
  hideLoading();
  setStatus("Ready for files", "Add hosted models or open a local splat.", "ready");
}

function hideEmptyState() {
  emptyPanel.hidden = true;
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

function normalizeManifest(rawManifest) {
  const manifestModels = Array.isArray(rawManifest)
    ? rawManifest
    : rawManifest?.models;

  if (!Array.isArray(manifestModels)) return [];

  return manifestModels
    .map((model, index) => {
      if (typeof model === "string") {
        return {
          name: model.split("/").pop() || `Model ${index + 1}`,
          path: model
        };
      }

      return {
        name: model.name || model.title || `Model ${index + 1}`,
        path: model.path || model.url,
        position: model.position,
        rotation: model.rotation,
        scale: model.scale,
        alphaThreshold: model.alphaThreshold ?? model.splatAlphaRemovalThreshold ?? 1,
        progressiveLoad: model.progressiveLoad ?? true
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

function fillModelSelect() {
  modelSelect.replaceChildren();

  if (!models.length) {
    const option = document.createElement("option");
    option.textContent = "No hosted models";
    modelSelect.append(option);
    modelSelect.disabled = true;
    reloadButton.disabled = true;
    return;
  }

  for (const [index, model] of models.entries()) {
    const option = document.createElement("option");
    option.value = String(index);
    option.textContent = model.name;
    modelSelect.append(option);
  }

  modelSelect.disabled = false;
  reloadButton.disabled = false;
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
  showLoading("Loading model", model.name);

  try {
    resetViewer();

    await viewer.addSplatScene(sourceUrl, {
      splatAlphaRemovalThreshold: model.alphaThreshold ?? 1,
      showLoadingUI: true,
      progressiveLoad: model.progressiveLoad ?? true,
      position: model.position ?? [0, 0, 0],
      rotation: model.rotation ?? [0, 0, 0, 1],
      scale: model.scale ?? [1, 1, 1]
    });

    viewer.start();
    setStatus("Live", model.name, "ready");
    hideLoading();
  } catch (error) {
    console.error(error);
    loadingPanel.classList.add("is-error");
    setStatus(
      "Model failed",
      "Check the file path, format, size, and browser console.",
      "error"
    );
    showToast("Could not load model");
  }
}

async function loadHostedModel(index) {
  cleanObjectUrl();
  const model = models[index];
  if (!model) return;
  await loadModel(model, modelPathToUrl(model.path));
}

async function loadLocalFile(file) {
  const lowerName = file.name.toLowerCase();
  if (!SUPPORTED_EXTENSIONS.some((extension) => lowerName.endsWith(extension))) {
    showToast("Use .ply, .splat, or .ksplat");
    return;
  }

  cleanObjectUrl();
  activeObjectUrl = URL.createObjectURL(file);
  await loadModel(
    {
      name: file.name,
      path: activeObjectUrl,
      progressiveLoad: true,
      alphaThreshold: 1
    },
    activeObjectUrl
  );
}

async function shareDashboard() {
  const shareData = {
    title: "Gaussian Viewer",
    text: "Open this self-hosted Gaussian splat viewer.",
    url: window.location.href
  };

  try {
    if (navigator.share) {
      await navigator.share(shareData);
      return;
    }

    await navigator.clipboard.writeText(shareData.url);
    showToast("Dashboard link copied");
  } catch (error) {
    if (error?.name !== "AbortError") showToast("Could not copy the link");
  }
}

modelSelect.addEventListener("change", () => {
  loadHostedModel(Number(modelSelect.value));
});

reloadButton.addEventListener("click", () => {
  if (activeObjectUrl && activeModel) {
    loadModel(activeModel, activeObjectUrl);
    return;
  }

  loadHostedModel(Number(modelSelect.value));
});

localModelButton.addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", () => {
  const [file] = fileInput.files;
  if (file) loadLocalFile(file);
  fileInput.value = "";
});

shareButton.addEventListener("click", shareDashboard);

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
  const requestedIndex = models.findIndex((model) => {
    const slug = model.slug || model.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    return slug === requestedModel || model.name === requestedModel;
  });

  const modelIndex = requestedIndex >= 0 ? requestedIndex : 0;
  modelSelect.value = String(modelIndex);
  await loadHostedModel(modelIndex);
}

startDashboard();
