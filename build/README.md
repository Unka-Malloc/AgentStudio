# Build Outputs

`build` is the root for generated and local runtime output.

- `build/dist`: Vue server console static bundle.
- `build/release`: packaged server archives.
- `build/client-gui`: Pact desktop/mobile client build artifacts, including
  desktop bundles and Android APK outputs.
- `build/client-cli/target`: Rust client CLI build cache used by repository
  npm scripts.
- `build/coverage`: LCOV reports for Node/Vue, Flutter, and Rust coverage
  gates.
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
Use the repository npm scripts for client builds and coverage so Flutter and
Cargo outputs are staged here instead of under `client-gui/` or
`client-cli/target/`.
