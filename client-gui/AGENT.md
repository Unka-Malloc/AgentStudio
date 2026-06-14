# Client GUI Agent Entry

## Scope

- Owns the Flutter desktop client under `client-gui/`.
- Keep GUI changes inside `client-gui/` unless the task explicitly changes the
  Rust CLI, server API, packaging, or shared docs contract.

## First Reads

- Start with root `AGENT.md`, then this file.
- Read `client-gui/README.md` for local setup and product boundary.
- Inspect `client-gui/pubspec.yaml` before changing dependencies.
- Use `client-gui/lib/main.dart` and `client-gui/lib/app.dart` to enter the app
  tree, then open only the relevant feature files.

## Directory Routing

- `client-gui/lib/`: Flutter application code.
- `client-gui/test/`: widget, service, state, and contract tests.
- `client-gui/scripts/`: packaging and client architecture verifiers.
- Platform folders (`macos/`, `windows/`, `linux/`) are only for native shell,
  packaging, or platform-specific behavior.

## Verification

- Use `npm run client:analyze` for Flutter static analysis.
- Use `npm run client:test` for Flutter tests.
- Use `npm run client:test:coverage` when LCOV output is needed; the report is
  written to `build/coverage/client-gui/lcov.info`.
- Use `npm run client:verify:architecture` when architecture rules or module
  boundaries change.

## Context Budget

- Do not load `build/client-gui/`, `client-gui/build/`, `.dart_tool/`, coverage
  output, or generated platform artifacts.
- Avoid reading CLI code unless the GUI task depends on a native CLI contract.
