# ADR 0002: Capability Key Kernel and Opaque Token Design

## Metadata / 元数据

- Last updated: 2026-06-11
- Status: Current maintained document
- Scope: ADR 0002 - Capability Key Kernel and Opaque Token Design.
- Staleness check: Scanned on 2026-06-11; current release/readiness claims were checked against docs/reports/history/v001-readiness/20260606T121950Z/report.md and docs/reports/history/production-readiness/20260606T122049Z/report.md.

## Status
Accepted

## Context
Traditional session tokens (JWT) or simple API keys often expose too much information (claims/scopes) or lack a centralized "Fail Closed" mechanism. In Pact, agents should only hold an **opaque capability key** that does not reveal its associated permissions.

## Decision
1. **Opaque Keys**: Use `ock_` prefixed random high-entropy strings as caller keys.
2. **Capability Kernel**: A centralized, encapsulated service that performs `verify(opaqueKey, requestedCapability)`.
3. **No Batch Disclosure**: The kernel never provides an interface to "list all capabilities" for a key.
4. **Binding Guard**: An outer layer that ensures the key is being used by the correct subject/agent/namespace.
5. **Sealed State**: The permission mapping is stored in a sealed (encrypted) state, isolated from the general business database.

## Consequences
- Enhanced security against "agent rogue" scenarios as agents cannot infer their capabilities.
- Requires a mandatory "Fail Closed" check in the Operation Scheduling Kernel.
- Slightly higher latency due to kernel introspection, mitigated by in-memory indexing of the sealed state.
