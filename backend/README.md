# Gaussian Viewer Backend

This backend adds the private/product layer that GitHub Pages cannot provide by
itself:

- Microsoft sign-in
- one workspace per user
- owner OneDrive folder creation
- resumable OneDrive upload sessions
- per-user model lists
- demo fallback models
- private share-token links

The frontend can still run without this backend. When `VITE_GV_API_BASE_URL` is
empty, the dashboard falls back to the static GitHub Pages manifest.

## Local setup

```bash
cd backend
npm install
copy .env.example .env
npm run dev
```

Then set the frontend `.env.local`:

```text
VITE_GV_API_BASE_URL=http://localhost:8787
VITE_GV_OWNER_EMAIL=shradaya.poudel@gallimaps.com
```

Run the frontend separately:

```bash
npm install
npm run dev
```

## Microsoft setup

Create an app registration in Microsoft Entra:

1. Add a web redirect URI:

   ```text
   http://localhost:8787/api/auth/callback
   ```

   Later add your production API callback, for example:

   ```text
   https://api.yourdomain.com/api/auth/callback
   ```

2. Create a client secret.
3. Add delegated permission:

   - `User.Read`

4. For owner OneDrive storage, add application permission:

   - `Files.ReadWrite.All`

   Admin consent is normally required for application permissions.

5. Fill the backend `.env`.

## Environment variables

```text
PORT=8787
NODE_ENV=development
FRONTEND_ORIGIN=http://localhost:5173
FRONTEND_APP_PATH=/
BACKEND_BASE_URL=http://localhost:8787
SESSION_SECRET=replace-with-a-long-random-secret
MS_CLIENT_ID=...
MS_CLIENT_SECRET=...
MS_TENANT_ID=...
GRAPH_DRIVE_ID=...
GRAPH_ROOT_FOLDER=GaussianViewer
OWNER_EMAIL=shradaya.poudel@gallimaps.com
DEMO_MODEL_URL=
```

For GitHub Pages as the frontend:

```text
FRONTEND_ORIGIN=https://shradaya-raj.github.io
FRONTEND_APP_PATH=/geosplat-dashboard/
```

For your own domain:

```text
FRONTEND_ORIGIN=https://viewer.yourdomain.com
FRONTEND_APP_PATH=/
BACKEND_BASE_URL=https://api.yourdomain.com
```

## API

### Auth

- `GET /api/auth/login`
- `GET /api/auth/callback`
- `GET /api/auth/logout`
- `GET /api/session`

### Models

- `GET /api/models`
  - signed-in users receive only their own published models
  - users with no published models receive demo models
- `GET /api/models?share=<token>`
  - public share-token view for selected models only

### Uploads

- `POST /api/uploads/session`

Body:

```json
{
  "filename": "site-block-01.splat",
  "size": 123456789
}
```

Returns a Microsoft Graph `uploadUrl`. The browser uploads chunks directly to
that URL, so large files do not pass through this backend.

- `POST /api/uploads/complete`

Body:

```json
{
  "driveItem": {
    "id": "...",
    "name": "site-block-01.splat",
    "size": 123456789
  }
}
```

The uploaded model is recorded as `pending`. It should be reviewed/processed
before being marked as `published`.

### Shares

- `POST /api/shares`

Body:

```json
{
  "modelIds": ["model-id"]
}
```

Only the owner can create a share link for their own published models.

## OneDrive folder layout

```text
GaussianViewer/
  users/
    user_xxxxxx/
      uploads/
        original/
        processed/
```

Only files in `uploads/processed` are automatically scanned as published/viewable
models for that user.
