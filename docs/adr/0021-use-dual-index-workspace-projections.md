# Use Dual-Index Workspace Projections

Workspace Projection will use two Verifiable Index Engine-backed indexes: a Workspace Order Index from workspace-local order to ledger event references, and a Workspace Membership Index from ledger event identifiers to workspace-local membership material. LicoLite needs both verifiable workspace ordering for views and verifiable event membership for proof checks.
