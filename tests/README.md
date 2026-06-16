# Pact Tests

This directory stores repository-level test assets.

- `tests/run.mjs`: unified test runner for repository profiles, tagged suites,
  platform gates, and JSON reports.
- `tests/verify-secret-hygiene.mjs`: source, docs, and test secret scan.
- `tests/server`: server verification mounts and mock modules.
- `tests/fixtures`: small synthetic fixtures only.

Package-local tests remain with their owning implementation:

- `client-cli/tests`
- `client-gui/test`

Generated test output must still go under `build/`; downloaded evaluation
corpora, real mailboxes, imported messages, and other real document sample sets
must live outside the repository under `~/.pact-server-data/evaluation-corpora/`.
`tests/` is for small synthetic fixtures, mock modules, and source-controlled
test code.

See `docs/runbook/DEVELOPMENT-RUNBOOK.md` for the full framework contract.
