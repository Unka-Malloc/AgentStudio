# ADR 0006: External Connector Live vs Contract Distinction

## Metadata / 元数据

- Last updated: 2026-06-07
- Status: Current maintained document
- Scope: ADR 0006 - External Connector Live vs Contract Distinction.
- Staleness check: Scanned on 2026-06-07; current release/readiness claims were checked against docs/reports/history/v001-readiness/20260606T121950Z/report.md and docs/reports/history/production-readiness/20260606T122049Z/report.md.

## Status
Accepted

## Context
Testing with real external services (GitHub, OneDrive, Dify) requires credentials that may not be available in CI or early dev environments.

## Decision
1. **Contract Verified**: A status indicating the adapter code correctly handles the API schema (mocks/contract tests passed).
2. **Remote Live Verified**: A status indicating successful end-to-end communication with the real service using valid credentials.
3. **Readiness Report Impact**: A release claim of "Production Ready" requires `Remote Live Verified` for all mandatory connectors.

## Consequences
- Prevents false confidence based only on unit/contract tests.
- Clearly distinguishes between "it's coded" and "it's proven".
