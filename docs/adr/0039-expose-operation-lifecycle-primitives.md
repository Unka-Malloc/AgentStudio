# Expose Operation Lifecycle Primitives

Pactium will keep high-level operation recording as a convenience API, but the public proof-first API must expose Operation Intent, Operation Outcome, and Open Intent recovery primitives. The lifecycle model is append-only, so callers need direct access to the facts and indexes that make recovery and verification explicit.
