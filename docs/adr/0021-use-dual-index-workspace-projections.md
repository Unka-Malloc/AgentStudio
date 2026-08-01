# Use Dual-Index Workspace Projections

Workspace Projection uses two Verifiable Index Engine-backed indexes: a Workspace Order Index from workspace-local order to ledger event references, and a Workspace Membership Index from ledger event identifiers to workspace-local membership material. Hosts can independently verify both workspace-local ordering and whether an event belongs to a projection.
