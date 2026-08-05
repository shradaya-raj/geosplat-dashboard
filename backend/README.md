# Gaussian Viewer Backend

Backend API for the Gaussian Viewer product layer.

Current architecture:

```text
Frontend dashboard
  -> Backend API
  -> Supabase Auth + Postgres metadata
  -> Cloudflare R2 private model files
```

Cloudflare R2 stores the large `.ply`, `.splat`, `.ksplat`, and `.spz` files.
Supabase stores users, profiles, model ownership, and share links.

## Local setup

```bash
cd backend
npm install
copy .env.example .env
npm run dev
```

## Environment

Fill `backend/.env`:

```text
PORT=8787
NODE_ENV=development
FRONTEND_ORIGIN=http://localhost:5173
FRONTEND_APP_PATH=/
BACKEND_BASE_URL=http://localhost:8787
SESSION_SECRET=replace-with-a-long-random-secret

STORAGE_PROVIDER=r2

SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

CLOUDFLARE_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET=gaussian-models
R2_PUBLIC_BASE_URL=
R2_SIGNED_URL_EXPIRES_SECONDS=3600

OWNER_EMAIL=shradaya.poudel@gallimaps.com
DEMO_MODEL_URL=
MAX_UPLOAD_BYTES=107374182400
```

Never commit `.env`.

## Cloudflare R2 setup

1. Open Cloudflare dashboard.
2. Go to `Storage & databases -> R2`.
3. Create bucket:

   ```text
   gaussian-models
   ```

4. Go to `R2 -> Overview -> Manage API Tokens`.
5. Create an R2 token:

   ```text
   Permission: Object Read & Write
   Scope: gaussian-models bucket only
   ```

6. Copy the account ID, access key ID, and secret access key into `.env`.

Test:

```bash
npm run diagnose:r2
```

Expected:

```text
Cloudflare R2 credentials work.
Generated a temporary upload URL successfully.
```

## Supabase setup

1. Create a Supabase project.
2. Open `Project Settings -> API`.
3. Copy:

   ```text
   SUPABASE_URL
   SUPABASE_ANON_KEY
   SUPABASE_SERVICE_ROLE_KEY
   ```

4. Open `SQL Editor`.
5. Run:

   ```text
   backend/supabase-schema.sql
   ```

This creates:

```text
profiles
models
share_links
```

with row-level security policies prepared for per-user access.

## API status

Implemented:

- `GET /health`
- `GET /api/session`
- `GET /api/models`
- `POST /api/uploads/session`
- `POST /api/uploads/complete`
- `POST /api/shares`
- `GET /api/auth/login` placeholder
- `GET /api/auth/logout` placeholder

The model repository layer automatically uses Supabase when `SUPABASE_URL` and
`SUPABASE_SERVICE_ROLE_KEY` are configured. If they are empty, it falls back to a
local JSON file for development only.

Next phase:

- connect the frontend Supabase login/signup flow
- add owner/admin approval workflow for `pending -> published`
- add a browser upload UI that calls the R2 upload endpoints

## R2 object layout

```text
gaussian-models/
  demo/
    processed/

  users/
    {userId}/
      original/
      processed/
```

R2 objects should remain private. The backend returns short-lived signed URLs
only when the user has permission.
