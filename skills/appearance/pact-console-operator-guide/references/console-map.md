# Server Console Operator Map

Entry points:

- `npm run server:console`
- `npm run server:start -- --with-ui`
- `GET /api/console/state`
- `GET /api/runtime/info`
- `GET /api/runtime/mounts`
- `POST /api/runtime/mounts`
- `POST /api/runtime/mounts/reload`
- `GET /api/settings`
- `POST /api/settings`

Console areas:

- Basic settings: provider, models, cloud parsing limits, OCR, Tika/JRE, analysis module.
- Module management: analysis, ocr, multimodalParser, documentParser, knowledgeBase, vectorStore, graphStore.
- Mount routing: extension, media type, and source kind routes.
- Storage: summary, deletion, rebuild, reconcile.
- Jobs: upload, progress, result, export.
- Clients and discovery: bootstrap, check-in, active service, forward mode, migration.

When documenting a UI control, trace it through `server-web/ServerConsoleApp.vue`, `server-web/lib/bridge.ts`, and the matching HTTP controller.
