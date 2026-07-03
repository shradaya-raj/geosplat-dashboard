# GeoSplat Observatory

A static, GitHub Pages-ready dashboard for the georeferenced MapTiler model:

`019f266c-4b5c-7c93-92a6-d59287b2f7cb`

## Run locally

1. Copy `.env.example` to `.env.local`.
2. Add a MapTiler browser API key to `.env.local`:

   ```env
   VITE_MAPTILER_API_KEY=your_key_here
   ```

3. Allow `localhost:5173` in the key's HTTP-origin restrictions.
4. Install and run:

   ```bash
   npm install
   npm run dev
   ```

## Publish through GitHub Pages

1. Create an empty GitHub repository and push this folder to its `main` branch.
2. In the repository, open **Settings → Secrets and variables → Actions**.
3. Create a repository secret named `MAPTILER_API_KEY` containing the browser API key.
4. Open **Settings → Pages** and select **GitHub Actions** as the source.
5. Push to `main`, or run **Deploy dashboard to GitHub Pages** from the Actions tab.
6. In MapTiler Cloud, restrict the key to the production origin:

   ```text
   YOUR_GITHUB_USERNAME.github.io
   ```

   A URL path is not an HTTP origin, so do not include the repository name in the
   MapTiler allowed-origin value.

## Security note

The built dashboard contains a browser API key. This is normal for client-side
maps: the key is identification, not a secret. Protect it with MapTiler's allowed
HTTP-origin restriction. Never use a MapTiler service token in this project.
