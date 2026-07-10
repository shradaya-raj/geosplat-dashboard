# Gaussian Viewer

A self-hosted Gaussian splat dashboard for `.ply`, `.splat`, and `.ksplat`
models. It does not use MapTiler or a MapTiler API key.

## Add hosted models under 100 MB

1. Put model files in:

   ```text
   public/models/
   ```

2. Add each file to:

   ```text
   public/models/manifest.json
   ```

Example:

```json
{
  "models": [
    {
      "name": "Main capture",
      "path": "./models/main-capture.ksplat",
      "progressiveLoad": true,
      "alphaThreshold": 1,
      "position": [0, 0, 0],
      "rotation": [0, 0, 0, 1],
      "scale": [1, 1, 1]
    }
  ]
}
```

For best loading performance, use `.ksplat` when possible. Raw `.ply` files can
be much larger and slower to load.

## Add large models over 100 MB for free

GitHub blocks normal repository files over 100 MB. For bigger Gaussian splat
files, upload them to the GitHub Release named `models`. The deployment workflow
then copies those release assets into the GitHub Pages site and automatically
generates the public model manifest.

Run this from the project folder:

```powershell
.\scripts\upload-model-to-release.ps1 -Path "C:\path\to\my-model.ksplat"
```

You can upload multiple models at once:

```powershell
.\scripts\upload-model-to-release.ps1 -Path "C:\path\to\one.ksplat","C:\path\to\two.ply"
```

Supported release asset formats:

- `.ply`
- `.splat`
- `.ksplat`

GitHub Releases support assets up to 2 GB each. GitHub Pages is still intended
for static sites, so keep the final published dashboard preferably below 1 GB
total for reliable deployments.

## Local testing

```bash
npm install
npm run dev
```

Then open:

```text
http://127.0.0.1:5173/
```

You can also drag a local `.ply`, `.splat`, or `.ksplat` file into the viewer
for testing without committing it.

## Publish through GitHub Pages

1. Push this folder to the `main` branch.
2. Open **Settings -> Pages** and select **GitHub Actions** as the source.
3. Push to `main`, or run **Deploy dashboard to GitHub Pages** from Actions.

## Hosting and security notes

- This is static web hosting. If a model file is listed in the dashboard, the
  browser must be able to download it to render it.
- Do not commit private source `.ply` files if you do not want visitors to be
  able to fetch them.
- GitHub rejects normal repo files over 100 MB. Use the `models` GitHub Release
  for larger files.
- For a smaller, faster file, convert `.ply` or `.splat` to `.ksplat`.
