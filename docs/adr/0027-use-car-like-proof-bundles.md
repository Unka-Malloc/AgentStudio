# Use CAR-Like Proof Bundles

Pactium Proof Bundles use a CAR-like indexed content-addressed block bundle with a Pactium manifest that names the root envelope, required blocks, protocol versions, ledger head, and critical extensions. This matches Pactium's CAS model while preserving Pactium-specific verification context instead of exporting unstructured blocks.

The bundle is not CARv1/CARv2 byte-compatible: Pactium CIDs are `cid:sha256:<hex>`, headers use Pactium Canonical Value bytes, and records are length-delimited Pactium block records. Verifiers must reject malformed varints, bad offsets, duplicate CID conflicts, oversized headers or blocks, missing required blocks, trailing bytes unless explicitly allowed, and corrupted required payloads.
