# Client CLI Agent Entry

## Scope

- Owns the Rust CLI under `client-cli/`.
- Keep native CLI changes inside `client-cli/` and directly related CLI smoke
  tests unless the task changes a server or GUI contract.

## First Reads

- Start with root `AGENT.md`, then this file.
- Inspect `client-cli/Cargo.toml` before adding dependencies or changing test
  targets.
- Use `client-cli/src/lib.rs` as the module map, then open only the relevant
  module.
- Use `docs/CLIENT_ARCHITECTURE.md` only when the CLI boundary with the desktop
  client or runtime model is unclear.

## Directory Routing

- `client-cli/src/targets.rs`: target discovery and target metadata.
- `client-cli/src/forwarding.rs`: forwarding behavior.
- `client-cli/src/client_state.rs` and `client-cli/src/paths.rs`: local state
  and path handling.
- `client-cli/src/mcp_plugins.rs` and `client-cli/src/mcp_trust.rs`: MCP plugin
  integration and trust handling.
- `client-cli/src/checkpoints.rs`: checkpoint-facing CLI behavior.

## Verification

- Use `cargo test --manifest-path client-cli/Cargo.toml` for broad CLI tests.
- Prefer targeted package scripts such as `npm run client:verify:targets` or
  `npm run client:verify:config-writes` when the task maps to one behavior.

## Context Budget

- Do not load `client-cli/target/`.
- Avoid reading GUI code unless the CLI/GUI contract is the task.
