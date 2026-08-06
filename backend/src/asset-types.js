export const ASSET_TYPES = {
  mesh_3d: {
    label: "3D Mesh",
    extensions: [".obj", ".fbx", ".glb", ".gltf", ".stl", ".dae", ".3dm", ".zip"],
    viewableExtensions: [".obj", ".glb", ".gltf", ".stl"]
  },
  gaussian_splatting: {
    label: "Gaussian Splatting",
    extensions: [".ply", ".splat", ".ksplat", ".spz"],
    viewableExtensions: [".ply", ".splat", ".ksplat", ".spz"]
  },
  point_cloud: {
    label: "Point Cloud",
    extensions: [".ply", ".las", ".laz", ".pcd", ".xyz", ".pts", ".e57", ".zip"],
    viewableExtensions: [".ply", ".pcd"]
  },
  orthomosaic: {
    label: "Ortho / Orthomosaic",
    extensions: [".tif", ".tiff", ".geotiff", ".tfw", ".prj", ".zip"],
    viewableExtensions: [".tif", ".tiff", ".geotiff"]
  }
};

export const DEFAULT_ASSET_TYPE = "gaussian_splatting";

export function normalizeAssetType(value) {
  return ASSET_TYPES[value] ? value : DEFAULT_ASSET_TYPE;
}

export function getAssetTypeLabel(value) {
  return ASSET_TYPES[normalizeAssetType(value)].label;
}

export function getSupportedExtensions(assetType = DEFAULT_ASSET_TYPE) {
  return ASSET_TYPES[normalizeAssetType(assetType)].extensions;
}

export function getViewableExtensions(assetType = DEFAULT_ASSET_TYPE) {
  return ASSET_TYPES[normalizeAssetType(assetType)].viewableExtensions || [];
}

export function getSupportedExtension(filename = "", assetType = DEFAULT_ASSET_TYPE) {
  const lower = filename.split("?")[0].split("#")[0].toLowerCase();
  return getSupportedExtensions(assetType).find((extension) => lower.endsWith(extension));
}

export function isRenderableGaussianAsset(assetType, extension) {
  return normalizeAssetType(assetType) === "gaussian_splatting"
    && getSupportedExtensions("gaussian_splatting").includes(extension);
}

export function isRenderableAsset(assetType, extension) {
  return getViewableExtensions(assetType).includes(extension);
}
