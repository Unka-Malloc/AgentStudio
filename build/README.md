# Build Outputs

`build` is the root for generated and local runtime output.

- `build/dist`: Vue server console static bundle.
- `build/release`: packaged server archives.
- `build/artifacts`: generated reports, screenshots, verification artifacts,
  and document outputs.
- `build/output`: ad hoc browser and inspection output.
- `build/tmp`: temporary workspace output.

The default local server data directory is `~/.pact-server-data/` (outside the
repository) so uploaded knowledge persists outside disposable build output.

Everything here is disposable unless a run explicitly produced an artifact that
should be promoted into docs or tests.

Repository tooling enforces this rule with:

```bash
npm run repo:hygiene
```

If a command needs to create screenshots, exported documents, local databases,
archives, logs, or inspection output, its default path must be inside `build/`.
