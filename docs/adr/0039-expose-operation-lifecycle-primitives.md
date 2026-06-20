# Expose Operation Lifecycle Primitives

Pactium keeps high-level operation recording as a convenience API, but the public proof-first API also exposes Operation Intent, Operation Outcome, and Open Intent recovery primitives. The lifecycle model is append-only, so callers have direct access to the facts and indexes that make recovery and verification explicit.
