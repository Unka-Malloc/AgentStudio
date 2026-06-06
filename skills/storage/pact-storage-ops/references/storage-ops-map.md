# Storage Operations Map

Primary scripts:

- `npm run server:doctor`
- `npm run server:locate`
- `npm run server:reconcile`
- `npm run server:rebuild-metadata`
- `npm run server:verify:ops`

Storage roots:

- `$PACT_SERVER_DATA_DIR/metadata/pact.sqlite`
- `$PACT_SERVER_DATA_DIR/objects/`
- `$PACT_SERVER_DATA_DIR/jobs/`
- `$PACT_SERVER_DATA_DIR/upload-sessions/`

Rules:

- Prefer read-only doctor and locate before reconcile.
- Rebuild metadata only when the SQLite index is stale or damaged.
- Do not delete raw objects until the batch deletion coordinator has removed metadata and files together.
