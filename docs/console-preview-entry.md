# Parallel console preview entry (draft)

This change is a production Worker routing proposal and must remain unmerged
until reviewed. It does not contain an approved replacement frontend bundle.

The existing `/` shell and `/v2/assets/*` continue to serve the existing site.
The separate `/preview/` entry serves only `PREVIEW_PAGE_HTML` and
`PREVIEW_ASSETS` from `web/strategy-switch-console/preview_asset_map.js`.
`/preview` redirects to `/preview/` while retaining its query string. Only GET
and HEAD are accepted. Unknown paths, missing assets and `/preview/api/*` return
404; there is no fallback to the old site. The checked-in empty bundle returns
404 until a reviewed preview build replaces it.

The preview shell uses no-store. Its hashed bundles use immutable caching in
the independent `/preview/assets/*` namespace. Existing security headers apply.
Login, callback and authenticated `/api/*` paths are shared with the existing
site; no new authentication configuration or permission is needed. Preview is
not a sandbox for mutations: any API action still uses the existing production
guards and confirmation requirements.

## Building the separate frontend

From the repository root, with the approved new frontend source checked out:

```sh
npm ci --prefix web/strategy-switch-console/frontend
npm run build --prefix web/strategy-switch-console/frontend -- --base=/preview/ --outDir=dist-preview
node web/strategy-switch-console/frontend/scripts/sync-v2-asset-map.mjs --preview
```

The generator reads only `frontend/dist-preview` and writes only
`preview_asset_map.js`. It rejects HTML that refers to `/v2/` or lacks the
preview asset base. The icon follows Vite's `BASE_URL`, producing the same icon
path as before for ordinary builds. Do not run the ordinary production asset
sync on a preview build. The existing deployment workflow continues rebuilding
the ordinary old-site bundle; it does not generate a preview bundle implicitly.

Before publication, review the actual new frontend and generated preview map,
confirm independent asset URLs and API guards, and verify both entry paths.
Merge and deployment require the owner's review of this routing PR. No deploy
is performed by this draft. To remove a preview later, restore the empty
preview map; the old-site map remains independent.

Synthetic validation: `node tests/console_preview_entry_validation.mjs`.
It checks GET/HEAD, method denial, missing assets, retained query parameters,
unchanged production shell/assets, existing auth/security headers, separate
asset generation and rejection of cross-namespace references.
