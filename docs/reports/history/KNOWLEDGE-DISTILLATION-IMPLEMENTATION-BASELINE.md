# Pact Knowledge Distillation Implementation Baseline

Date: 2026-05-30

This document is the implementation baseline for replacing the outdated
knowledge-distillation algorithm. It turns the audit and evolution notes into
the current acceptance contract for implementation.

## Product Target

The only user-facing flow that must be treated as complete is:

1. Upload files in the server console.
2. Start knowledge distillation from the uploaded/parsed files.
3. Download the generated distillation artifact.

The internal runtime may be rebuilt destructively if needed, but the console
flow must stay coherent and verifiable.

## Algorithm Contract

The distillation runtime must no longer behave as a single-cluster document
packer. A completed run must expose these artifacts:

- `sourcePlan`: ordered source records with detected timestamps, importance,
  time-decayed importance, source order, and embedding metadata.
- `semanticClusters`: topic clusters built from semantic similarity, lexical
  overlap, temporal compatibility, and source boundaries.
- `claimLedger`: data-derived claims extracted from batch findings and final
  portable documents, with claim-level coverage and grounding status.
- `qualityReportV3`: numeric quality report that includes source coverage,
  semantic coverage, citation coverage, timeline order, duplicate risk,
  unsupported claims, and time-decay calibration.
- `externalEvaluation`: a data-driven evaluator independent of the distiller
  prompt. It must score output quality from source-derived claims and
  timelines rather than trusting the model's own review.

Timeline handling is mandatory. `timeline_then_topic` must sort source material
by detected time before final composition and must report whether the exported
document preserved that order. Unknown timestamps are allowed, but they must be
counted separately and must not be silently treated as chronological proof.

Time-importance decay is mandatory. Each source receives:

- `importanceScore`: content importance estimated from source length, decision
  language, risk language, evidence density, and user query overlap.
- `temporalWeight`: an exponential recency weight with a non-zero floor, so old
  but important documents are downweighted without being discarded.
- `decayedImportanceScore`: `importanceScore * temporalWeight`.

The default half-life is 90 days and the default floor is 0.35. These defaults
are intentionally conservative: they prioritize recent material while still
allowing older design decisions or legal/business records to remain visible.

## External Evaluation Contract

The first external evaluator is `data_driven_semantic_claim_coverage_v1`.

It builds an evaluation dataset from raw corpus batch findings, source titles,
timestamps, and final portable documents. It then computes:

- semantic claim coverage by embedding expected claims and generated markdown;
- lexical claim coverage as a cheap regression signal;
- source coverage over uploaded files;
- citation density and citation recall;
- timeline order preservation;
- unsupported claim rate from the evidence gate and claim ledger;
- time-decay calibration over the chosen source order.

This evaluator is external to the distillation prompt. It can later be bridged
to DeepEval, G-Eval, Ragas, or Phoenix, but local deterministic scoring must
remain available for CI and offline development.

## Console Acceptance

The console must make the flow inspectable without requiring users to understand
runtime internals:

- The knowledge page must expose upload, distillation, and export in one
  continuous path.
- A completed run must show the generated document and export links.
- Stage metrics must surface `qualityReportV3` and `externalEvaluation` summary
  values.
- The debug panel may remain, but it is not the only acceptable entry.

## Verification

At minimum, implementation must update the existing workbench verifier so it
proves:

- multi-topic uploads create more than one semantic cluster when appropriate;
- source timestamps are detected and ordered;
- time-importance decay is applied and reported;
- `qualityReportV3` and `externalEvaluation` are present and numeric;
- the exported Markdown for `knowledge-distillation` is non-empty;
- the console flow still supports upload -> parse -> distill -> export.

The legacy boolean checks can remain as smoke tests, but they are no longer
sufficient evidence that the algorithm is acceptable.
