import { Map, SplatModel, config } from "@maptiler/geosplats";
import "@maptiler/geosplats/dist/maptiler-geosplats.css";
import "./style.css";

const MODEL_ID = "019f266c-4b5c-7c93-92a6-d59287b2f7cb";
const API_KEY = import.meta.env.VITE_MAPTILER_API_KEY;

const connectionLabel = document.querySelector("#connection-label");
const modelStatus = document.querySelector("#model-status");
const loadingPanel = document.querySelector("#loading-panel");
const loadingTitle = document.querySelector("#loading-title");
const loadingDetail = document.querySelector("#loading-detail");
const setupMessage = document.querySelector("#setup-message");
const basemapSelect = document.querySelector("#basemap-select");
const resetButton = document.querySelector("#reset-view");
const shareButton = document.querySelector("#share-button");
const toast = document.querySelector("#toast");

let map;
let splatModel;

function setStatus(label, detail, state = "loading") {
  connectionLabel.textContent = label;
  modelStatus.textContent = label;
  loadingTitle.textContent = label;
  loadingDetail.textContent = detail;
  document.documentElement.dataset.state = state;
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("is-visible");
  window.setTimeout(() => toast.classList.remove("is-visible"), 2400);
}

async function shareDashboard() {
  const shareData = {
    title: "GeoSplat Observatory",
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
    return;
  }

  config.apiKey = API_KEY;

  map = new Map({
    apiKey: API_KEY,
    container: "map",
    center: [0, 20],
    zoom: 1.5,
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
      splatModel.fit();
      setStatus("Live", "Model ready", "ready");
      loadingPanel.classList.add("is-complete");
      window.setTimeout(() => {
        loadingPanel.hidden = true;
      }, 500);
      resetButton.disabled = false;
    });

    splatModel.once("error", () => {
      setStatus(
        "Model unavailable",
        "Check that the model is published and the API key permits this domain.",
        "error"
      );
      loadingPanel.classList.add("is-error");
    });

    map.addSplatModel(splatModel);
  });

  map.on("error", () => {
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
    if (splatModel) splatModel.fit();
  });
}

startDashboard();
