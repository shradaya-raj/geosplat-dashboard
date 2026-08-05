# Gaussian Viewer

A self-hosted Gaussian splat dashboard for `.ply`, `.splat`, `.ksplat`, and `.spz`
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
- `.spz`

GitHub Releases support assets up to 2 GB each. GitHub Pages is still intended
for static sites, so keep the final published dashboard preferably below 1 GB
total for reliable deployments.

## Share a model link

There are two loading modes:

- **Open file / drag-and-drop**: local preview only. The model stays on your
  computer, so other people cannot see it from a shared link.
- **GitHub Release model**: public/shareable. Upload the model to the `models`
  Release, let GitHub Pages redeploy, then share the dashboard URL.

After a hosted model is loaded, the dashboard URL becomes:

```text
https://shradaya-raj.github.io/geosplat-dashboard/?model=model-name
```

Use the **Share** button after loading a hosted model to copy the direct model
link.

## Submit from any computer without command prompt

The current public dashboard supports local preview and email-based submission.
The production upload flow will use the backend to create short-lived Cloudflare
R2 upload URLs, then store metadata in Supabase.

Submitted files are review-only until the owner processes and publishes them.

## Local testing

```bash
npm install
npm run dev
```

Then open:

```text
http://127.0.0.1:5173/
```

You can also drag a local `.ply`, `.splat`, `.ksplat`, or `.spz` file into the viewer
for testing without committing it.

## Private user workspaces

The dashboard is prepared for a backend API. Without the backend, it runs in
static GitHub Pages mode. With the backend connected, each signed-in user can
see only their own published cloud-hosted models, while new users can receive a
demo model fallback.

Recommended storage for large models is now:

```text
Supabase = auth, database, profiles, model ownership, share links
Cloudflare R2 = large Gaussian splat files
```

This keeps large model storage cheap and avoids tenant-specific storage approvals.
See:

```text
backend/README.md
backend/supabase-schema.sql
```

Frontend environment:

```text
VITE_GV_API_BASE_URL=https://api.yourdomain.com
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-public-anon-key
VITE_GV_OWNER_EMAIL=shradaya.poudel@gallimaps.com
```

Backend code and setup steps live in:

```text
backend/
```

When the frontend and backend environment variables are configured, users can
sign in with a Supabase magic link, upload model files directly to Cloudflare R2
through a signed URL, and wait for owner approval before the model appears in
their hosted list.

## Publish through GitHub Pages

1. Push this folder to the `main` branch.
2. Open **Settings -> Pages** and select **GitHub Actions** as the source.
3. Push to `main`, or run **Deploy dashboard to GitHub Pages** from Actions.

## Host uploads from any device

GitHub Pages can host the frontend, but uploads need the backend API online.
Recommended first deployment:

```text
Frontend: GitHub Pages
Backend: Render Web Service
Auth/database: Supabase
Large model files: Cloudflare R2
```

### 1. Deploy backend on Render

The repository includes `render.yaml`. Create a Render Blueprint/Web Service
from this GitHub repository. Render should use:

```text
Root directory: backend
Build command: npm ci
Start command: npm start
Health check: /health
```

Add these Render environment variables:

```text
NODE_ENV=production
FRONTEND_ORIGIN=https://shradaya-raj.github.io
FRONTEND_APP_PATH=/geosplat-dashboard/
BACKEND_BASE_URL=https://your-render-service.onrender.com
SESSION_SECRET=generate-a-long-random-secret

SUPABASE_URL=https://juxqaenivgwutpnuxogo.supabase.co
SUPABASE_ANON_KEY=your-supabase-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-supabase-service-role-key

CLOUDFLARE_ACCOUNT_ID=your-cloudflare-account-id
R2_ACCESS_KEY_ID=your-r2-access-key-id
R2_SECRET_ACCESS_KEY=your-r2-secret-access-key
R2_BUCKET=gaussian-models
R2_PUBLIC_BASE_URL=
R2_SIGNED_URL_EXPIRES_SECONDS=3600
MAX_UPLOAD_BYTES=107374182400

OWNER_EMAIL=shradaya.poudel@gallimaps.com
APPROVAL_EMAIL=shradayarajpoudel@gmail.com
EMAIL_FROM=Gaussian Viewer <onboarding@resend.dev>
RESEND_API_KEY=your-resend-api-key
```

Keep `R2_PUBLIC_BASE_URL` empty for private signed download URLs.

`RESEND_API_KEY` enables approval emails. Without it, uploaded models are still
stored as pending, but the approval link is printed in backend logs instead of
being emailed.

### 2. Rebuild GitHub Pages with backend values

In GitHub, open:

```text
Repository -> Settings -> Secrets and variables -> Actions -> Variables
```

Add:

```text
VITE_GV_API_BASE_URL=https://your-render-service.onrender.com
VITE_SUPABASE_URL=https://juxqaenivgwutpnuxogo.supabase.co
VITE_SUPABASE_ANON_KEY=your-supabase-anon-key
VITE_GV_OWNER_EMAIL=shradaya.poudel@gallimaps.com
```

Then push to `main` or manually rerun the GitHub Pages workflow.

## Hosting and security notes

- This is static web hosting. If a model file is listed in the dashboard, the
  browser must be able to download it to render it.
- Do not commit private source `.ply` files if you do not want visitors to be
  able to fetch them.
- GitHub rejects normal repo files over 100 MB. Use the `models` GitHub Release
  for larger files.
- For a smaller, faster file, convert `.ply` or `.splat` to `.ksplat`.
