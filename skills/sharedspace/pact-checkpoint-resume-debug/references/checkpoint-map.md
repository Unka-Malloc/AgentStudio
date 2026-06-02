# Checkpoint And Resume Map

Server side:

- `server/protocols/checkpoint/upload-session-store.mjs`
- `server/platform/common/console/http/controllers/jobs-controller.mjs`
- `server/services/client/work-queue-core/jobs/job-manager.mjs`

Client side:

- `client-gui/lib/src/services/runtime_services.dart`
- `client-gui/test/runtime_services_test.dart`

Debug sequence:

1. Read local `checkpoints.json`.
2. `GET /api/upload-sessions/:sessionId`.
3. Compare `receivedBytes`, `byteSize`, and `sha256`.
4. On `offset_mismatch`, resume from server `expectedOffset`.
5. Do not reuse a checkpoint id for a different manifest digest.
6. After job creation, poll `GET /api/jobs/:id`.

The server deletes a completed upload session after the owning job finalizes.
