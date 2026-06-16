# ADR 0008: Risk Control Model Axis and Lifecycle

## Metadata / 元数据

- Last updated: 2026-06-16
- Status: Current maintained document
- Scope: ADR 0008 - Risk Control Model Axis and Lifecycle.
- Staleness check: Checked against current consolidated docs layout and referenced implementation evidence on 2026-06-16.

## Status
Accepted

## Context
Pact already has separate controls for Capability Kernel, Binding Guard, operation policy, approval, execution, audit, recovery, credentials, and provider boundaries. Calling the top-level design a permission model collapses credential authority, identity binding, resource policy, execution risk, and evidence into one layer.

## Decision
Pact's top-level model is the **Risk Control Model** (风控模型). It uses two axes: the 2-3-5 model (`boundary / environment / object`) defines risk ownership, and the request lifecycle (`admit -> bind -> authorize -> approve -> execute -> audit/recover`) defines where each control is enforced.

Every Risk Control Point must declare both axes, its fact source, fail-closed behavior, and audit evidence. Console configuration is only a projection over the model; the Permission Decision Model is one request-time layer inside the model, not the model itself.

## Considered Options
- **2-3-5 only**: keeps ownership clear but can become documentation-only without request-time enforcement gates.
- **Lifecycle only**: maps well to runtime execution but loses who owns each risk across boundaries, environments, and objects.
- **Console-driven model**: matches operator screens but turns UI grouping into the source of truth.

## Consequences
- Future risk-control optimizations must map to both ownership and lifecycle before being treated as complete.
- Capability Kernel remains narrow: it verifies `opaqueKey + requestedCapability`, while Binding Guard, Policy/ABAC/Risk, approval, execution, audit, and recovery remain separate controls.
- Existing documentation or implementation names that imply "security governance model" should be treated as legacy terminology and migrated deliberately.
