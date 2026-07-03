import { Map, SplatModel, config } from "@maptiler/geosplats";
import "@maptiler/geosplats/dist/maptiler-geosplats.css";
import "./style.css";

const MODEL_ID = "019f266c-4b5c-7c93-92a6-d59287b2f7cb";
const API_KEY = import.meta.env.VITE_MAPTILER_API_KEY;
const MAX_ZOOM = 22;
const MAX_MAGNIFICATION = 32;
const LOADING_FALLBACK_MS = 4000;

const connectionLabel = document.querySelector("#connection-label");
const loadingPanel = document.querySelector("#loading-panel");
const loadingTitle = document.querySelector("#loading-title");
const loadingDetail = document.querySelector("#loading-detail");
const setupMessage = document.querySelector("#setup-message");
const basemapSelect = document.querySelector("#basemap-select");
const resetButton = document.querySelector("#reset-view");
const closeUpButton = document.querySelector("#close-up");
const shareButton = document.querySelector("#share-button");
const toast = document.querySelector("#toast");

let map;
let splatModel;
let loadingFallback;
let userHasMoved = false;
let modelIsInteractive = false;
let modelLoadFailed = false;
let baseModelScale = null;
let magnification = 1;

function setStatus(label, detail, state = "loading") {
  connectionLabel.textContent = label;
  loadingTitle.textContent = label;
  loadingDetail.textContent = detail;
  document.documentElement.dataset.state = state;
}

function captureBaseModelScale() {
  if (baseModelScale !== null) return true;

  const scale = splatModel?.getScale();
  if (!Number.isFinite(scale) || scale <= 0) return false;
  baseModelScale = scale;
  return true;
}

function setMagnification(value) {
  if (!captureBaseModelScale()) return false;

  magnification = Math.min(MAX_MAGNIFICATION, Math.max(1, value));
  splatModel.setScale(baseModelScale * magnification);
  closeUpButton.textContent = magnification > 1
    ? `Zoom closer · ${magnification.toFixed(magnification < 10 ? 1 : 0)}×`
    : "Zoom closer";
  return true;
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("is-visible");
  window.setTimeout(() => toast.classList.remove("is-visible"), 2400);
}

function dismissLoadingPanel() {
  window.clearTimeout(loadingFallback);
  loadingPanel.classList.add("is-complete");
  window.setTimeout(() => {
    loadingPanel.hidden = true;
  }, 500);
}

async function shareDashboard() {
  const shareData = {
    title: "Gaussian Viewer",
    text: "Explore this interactive georeferenced 3D model.",
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

shareButton.addEventListener("click", shareDashboard);

async function startDashboard() {
  if (!API_KEY) {
    setStatus("Setup needed", "Add a MapTiler API key to load the scene.", "error");
    setupMessage.hidden = false;
    loadingPanel.hidden = true;
    basemapSelect.disabled = true;
    resetButton.disabled = true;
    closeUpButton.disabled = true;
    return;
  }

  let gpuAdapter = null;
  if ("gpu" in navigator) {
    try {
      gpuAdapter = await navigator.gpu.requestAdapter({
        powerPreference: "high-performance"
      });
    } catch {
      gpuAdapter = null;
    }
  }

  if (!gpuAdapter) {
    setStatus(
      "WebGPU unavailable",
      "Use the latest Chrome or Edge with hardware acceleration enabled. Firefox may expose WebGPU without providing a compatible adapter.",
      "error"
    );
    loadingPanel.classList.add("is-error");
    basemapSelect.disabled = true;
    resetButton.disabled = true;
    closeUpButton.disabled = true;
    return;
  }

  config.apiKey = API_KEY;

  map = new Map({
    apiKey: API_KEY,
    container: "map",
    center: [0, 20],
    zoom: 1.5,
    maxZoom: MAX_ZOOM,
    pitch: 45,
    bearing: 0,
    basemap: "hybrid-v4",
    navigationControl: true,
    modelResolutionControl: true
  });

  map.on("load", () => {
    setStatus("Loading model", "Streaming optimized splat detail…");

    splatModel = new SplatModel({ model: MODEL_ID });

    splatModel.once("load", () => {
      modelIsInteractive = true;
      captureBaseModelScale();
      if (!userHasMoved) splatModel.fit();
      setStatus("Live", "Model ready", "ready");
      dismissLoadingPanel();
      resetButton.disabled = false;
      closeUpButton.disabled = !captureBaseModelScale();
    });

    splatModel.once("error", () => {
      modelLoadFailed = true;
      window.clearTimeout(loadingFallback);
      setStatus(
        "Model unavailable",
        "Check that the model is published and the API key permits this domain.",
        "error"
      );
      loadingPanel.classList.add("is-error");
    });

    map.addSplatModel(splatModel);

    const scaleProbe = window.setInterval(() => {
      if (!captureBaseModelScale()) return;
      closeUpButton.disabled = false;
      window.clearInterval(scaleProbe);
    }, 250);
    window.setTimeout(() => window.clearInterval(scaleProbe), 30000);

    // Renderable splats often appear before every detail tile has finished
    // streaming. Do not keep the viewer covered while that continues.
    loadingFallback = window.setTimeout(() => {
      if (modelLoadFailed) return;

      modelIsInteractive = true;
      setStatus("Live", "High-detail tiles are streaming", "ready");
      dismissLoadingPanel();
      resetButton.disabled = false;
      closeUpButton.disabled = !captureBaseModelScale();
    }, LOADING_FALLBACK_MS);
  });

  map.on("error", () => {
    if (modelIsInteractive) return;

    setStatus(
      "Connection error",
      "Check your API key, allowed origins, and network connection.",
      "error"
    );
    loadingPanel.classList.add("is-error");
  });

  basemapSelect.addEventListener("change", (event) => {
    map.setBasemap(event.target.value);
  });

  resetButton.addEventListener("click", () => {
    if (!splatModel) return;
    setMagnification(1);
    splatModel.fit();
  });

  closeUpButton.addEventListener("click", () => {
    const center = splatModel?.getCenter();
    if (!center) return;

    userHasMoved = true;
    const nextMagnification = Math.min(
      MAX_MAGNIFICATION,
      magnification === 1 ? 2 : magnification * 2
    );
    setMagnification(nextMagnification);
    map.jumpTo({
      center,
      zoom: MAX_ZOOM,
      pitch: 65,
      bearing: map.getBearing()
    });
    showToast(
      magnification === MAX_MAGNIFICATION
        ? `Maximum close-up: ${MAX_MAGNIFICATION}×`
        : `Close-up: ${magnification}×`
    );
  });

  document.querySelector("#map").addEventListener("pointerdown", () => {
    userHasMoved = true;
  });

  document.querySelector("#map").addEventListener(
    "wheel",
    (event) => {
      userHasMoved = true;

      const atMapZoomLimit = map.getZoom() >= map.getMaxZoom() - 0.15;
      const zoomingIn = event.deltaY < 0;
      const zoomingOutFromMagnification = event.deltaY > 0 && magnification > 1;

      if ((zoomingIn && atMapZoomLimit) || zoomingOutFromMagnification) {
        event.preventDefault();
        event.stopPropagation();

        const factor = Math.exp(Math.min(Math.abs(event.deltaY) * 0.003, 0.35));
        setMagnification(
          zoomingIn ? magnification * factor : magnification / factor
        );
      }
    },
    { passive: false, capture: true }
  );
}

startDashboard();
