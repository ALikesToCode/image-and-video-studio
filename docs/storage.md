# Storage Architecture

## Browser Stores

- `sessionStorage`: default API key storage.
- React memory: manual API key mode and transient running state.
- `localStorage`: small preferences, selected model IDs, lightweight model caches, and persistent API keys only when explicitly selected.
- IndexedDB `studio-gallery`: generated media blobs, uploaded reference blobs, resumable job metadata, model catalogs, conversations, and settings records.

## IndexedDB Stores

The gallery DB is version 2 and keeps the legacy `images` store readable while newer data uses:

- `assets`
- `assetBlobs`
- `references`
- `jobs`
- `conversations`
- `modelCatalogs`
- `settings`

Generated media is shown through object URLs created from blobs. Object URLs are revoked on clear/delete/unmount.

## Migration Rules

- Old gallery blobs in `images` are still read.
- Old localStorage saved media metadata can be rehydrated into IndexedDB blobs when a data URL is still available.
- Heavy `studio_generated_images` state is treated as legacy session output and should be replaced by gallery-backed media IDs over time.
- Old `studio_api_key_*` entries are key-storage migration inputs, not current storage.

## Export And Import

Gallery export stays local to the browser. Current JSON export may include data URLs for portability, so large exports can be large. Future export should prefer a manifest plus binary blobs where browser support is practical.
