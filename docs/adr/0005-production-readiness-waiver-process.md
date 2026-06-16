# ADR 0005: Production Readiness Waiver Process

## Metadata / 元数据

- Last updated: 2026-06-16
- Status: Current maintained document
- Scope: ADR 0005 - Production Readiness Waiver Process.
- Staleness check: Checked against current consolidated docs layout and referenced implementation evidence on 2026-06-16.

## Status
Accepted

## Context
Pact uses strict P0/P1/P2 gates. However, in some research or pilot scenarios, we may need to bypass certain non-critical gates.

## Decision
1. **Waiver Registry**: All bypassed gates must be documented in a `production-readiness-waiver` registry.
2. **Approval Level**: Waivers for P1/P2 gates require Owner approval. P0 gates **cannot** be waived for production claims.
3. **Expiration**: Every waiver must have an expiration date, after which it becomes a blocking P0 issue.

## Consequences
- Allows controlled pilot programs without compromising long-term governance.
- Transparently tracks "technical debt" in the readiness report.
