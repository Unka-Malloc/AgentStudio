# Security Design 0001: Local Stdio Interfaces Are Disabled As Public Pact Surfaces

## Metadata / 元数据

- Last updated: 2026-06-14
- Status: Accepted
- Scope: Local stdio interface lockdown for public Pact MCP and external-service surfaces.
- Staleness check: Scanned on 2026-06-14; enforcement is owned by `server:verify:security-local-stdio-lockdown`.

## Status

Accepted

## Context

Pact is being prepared as a production MCP platform where external services are registered through ServiceHub and exposed to agents as governed MCP tools. A local `stdio` interface is materially different from an HTTP/HTTPS upstream address: it implies local process launch, stdin/stdout message framing, command arguments, working directories, environment variables, inherited process context, and host-local filesystem and credential adjacency.

Allowing `stdio` through a registration, discovery, composition, or MCP-facing interface would turn Pact from a governed external-service gateway into a local process launcher. Even when command execution is not reached, `stdio` descriptors can leak host topology through command names, argv, cwd, env names, local paths, runtime store locations, and connector configuration.

The production contract for ServiceHub is therefore external address to governed MCP tool, not local process to governed MCP tool. Local tools that need to participate must expose a controlled HTTP/HTTPS endpoint owned by that tool or be integrated as a non-public internal adapter with explicit review.

## Decision

Pact does not expose local `stdio` as a public framework interface.

This applies to:

- ServiceHub external-service registration.
- Raw MCP passthrough.
- ACP external-service registration.
- Composition presets loaded into active runtime/package plans.
- MCP discovery, initialize, `tools/list`, and capability responses.
- Package scripts or documented commands that start a source-facing local stdio interface.

`stdio`, `command`, `args`, `cwd`, and `env` descriptors are rejected for ServiceHub. ACP `stdio` external-service upstreams are disabled entirely. Historical source-facing stdio artifacts may remain only as retired audit records or disabled stubs; they must not validate as deployable presets, must not be loaded by default, and must not be advertised through public MCP payloads.

Internal test process pipes and private implementation details are not public interfaces by themselves. They remain acceptable only when they are not registrable, discoverable, invokable, or packaged as Pact framework entrypoints.

## Gate Ownership

The release gate for this decision is `npm run server:verify:security-local-stdio-lockdown`. In the production readiness gate this decision is tracked as `local-stdio-interface-lockdown`.

Functional verifiers for external-service registration, MCP HTTP, and ACP Relay must not own this policy. They may validate their normal protocol behavior, but the local-stdio attack-surface closure is managed as a security gate.

## Consequences

- External service onboarding must use HTTP/HTTPS transports, including Raw MCP Streamable HTTP and Raw MCP SSE.
- Agent Relay entrypoints exposed by Pact must use authenticated HTTP/HTTPS control surfaces rather than local source-facing stdio.
- Existing source-facing stdio composition presets are retired and skipped by active composition loading.
- The former source-facing stdio script fails closed if invoked directly.
- Verifiers must fail when public MCP payloads expose `stdio` transport or local process launch descriptors.

## Security Rationale

This removes a high-risk host authority path before production. It prevents agents, manifests, connector installers, or poisoned upstream descriptors from converting Pact into a host-local command launcher or from leaking local execution context. It also keeps ServiceHub aligned with its intended boundary: governed forwarding to externally owned HTTP/HTTPS services, with egress, secret, adoption, output, and audit controls enforced by Pact.
