# Pact Deployment Entry Index

Start with `server/config/deployment/index.json`. It is the machine-readable entry point for Docker presets, runtime dependency download paths, external service Dockerfiles, and the verification commands that prove those entries still match the implementation.

Useful commands:

```bash
npm run server:deployment-index
npm run server:deployment-index -- section dockerPresets
npm run server:verify:deployment-index
```

Deployment proof must run in fresh containers. Use the commands under `validation.freshContainer` in `index.json` when the touched area affects bootstrap, downloads, or container startup.
