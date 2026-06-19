# Build Outputs

`build` is the root for disposable generated output in this repository.

- `build/artifacts`: generated reports, screenshots, verification artifacts,
  and document outputs.
- `build/coverage`: optional coverage output when a local run chooses to emit
  reports.
- `build/output`: ad hoc browser and inspection output.
- `build/tmp`: temporary workspace output.

Pactium's default local data directory is `~/.pactium/` unless callers provide
`PACTIUM_DATA_DIR` or an explicit `dataDir`.

Everything here is disposable unless a run explicitly produced an artifact that
should be promoted into docs or tests.

Repository release readiness is checked with:

```bash
npm run verify:release
```

If a command needs to create screenshots, exported documents, local databases,
archives, logs, or inspection output, its default path must be inside `build/`.
