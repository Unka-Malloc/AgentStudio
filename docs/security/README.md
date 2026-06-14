# Pact Security Design

## Metadata

- Last updated: 2026-06-14
- Status: Current maintained document
- Scope: Security design records, security gates, and security-only threat decisions.

This directory is the home for Pact security design records. Product, protocol, runtime, and capability design records stay in their own documents; security records live here when the decision is primarily about threat reduction, attack-surface closure, credential handling, authorization, or fail-closed behavior.

Security gates are managed through dedicated `server:verify:security-*` npm scripts. Functional verifiers may still exercise security-sensitive behavior as normal regression tests, but release-blocking security assertions belong in security verifiers.

Current dedicated gates:

- `npm run server:verify:security-local-stdio-lockdown`
- Production readiness gate id: `local-stdio-interface-lockdown`

## Security Design Records

| Record | Status | Scope |
| --- | --- | --- |
| [0001-local-stdio-interface-lockdown.md](design/0001-local-stdio-interface-lockdown.md) | Accepted | Disable local stdio as a public Pact framework surface |
