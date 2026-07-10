# Gaussian Viewer

A self-hosted Gaussian splat dashboard for `.ply`, `.splat`, and `.ksplat`
models. It does not use MapTiler or a MapTiler API key.

## Add hosted models

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
- GitHub rejects files over 100 MB. Large production models should be hosted on
  object storage/CDN and listed in the manifest by URL.
- For a smaller, faster file, convert `.ply` or `.splat` to `.ksplat`.
