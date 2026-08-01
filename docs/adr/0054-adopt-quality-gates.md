# Adopt Quality Gates

Pactium uses the automated release gate documented in `docs/QUALITY-GATES.md`: coverage-enforced tests, deterministic proof vectors, regression snapshots, seeded property checks, scaled public API pressure profiles, release-readiness checks, and package dry run.

A proof-first protocol package cannot be considered complete with unit tests alone because hosts depend on stable verification behavior, public API durability, content-boundary enforcement, and measurable performance through exported APIs. Stronger gates require matching implementation before maintained docs may describe them as release-blocking.
