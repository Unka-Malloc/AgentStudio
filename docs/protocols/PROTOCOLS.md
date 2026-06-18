# Pactium Protocols

## Operation Ledger

`createOperationLedger({ dataDir })` stores operation entries in `operation-ledger/operation-ledger.sqlite`.

Stable fields include:

- `operationId`
- `workspaceId`
- `subject`
- `risk`
- `status`
- `receiptRefs`
- `ledgerEventId`

## Checkpoint Tree

`createCheckpointTreeStore({ dataDir })` stores checkpoint trees in `checkpoint-trees/*.json`.

Stable operations:

- `startTree`
- `upsertNode`
- `finishTree`
- `diffTree`
- `queryScope`
- `previewRestore`
- `restore`

`restore` records a new marker node and does not rewrite older nodes.

## Merkle State Substrate

`createMerkleStateSubstrate({ dataDir })` exposes:

- `cas`
- `merkleDag`
- `merkleIndex`
- `eventLog`
- `stateCommit`
- `lsmIngest`

## Kernel

`createPactiumKernel({ dataDir }).recordOperation(input)` writes:

- an Operation Ledger entry
- a Checkpoint Tree node
- an optional Merkle state commit when `input.state.mutations` is present

The response includes `ledgerEventId`, `checkpointTreeId`, `checkpointNodeId`, and `stateCommitId` when a state commit is created.
