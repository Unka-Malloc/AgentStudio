# Adopt Quality Gates

Pactium uses the automated release gate documented in `docs/QUALITY-GATES.md`: coverage-enforced tests, deterministic proof vectors, regression snapshots, seeded property checks, scaled public API pressure profiles, release-readiness checks, and package dry run.

A proof-first protocol package cannot be considered complete with unit tests alone because LicoLite depends on stable verification behavior, public API durability, and measurable performance under exported APIs. Stronger gates such as per-critical-module coverage thresholds or benchmark baseline regression checks require matching implementation before maintained docs may describe them as release-blocking.
