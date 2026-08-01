# Support New Data Directories Only

Pactium accepts only data directories created with the current schema and manifest-bound backend. It does not read, dual-write, discover, import, rename, or migrate non-current or retired-product state in place. Hosts initialize fresh current-schema state and preserve portable evidence through Proof Bundles when required.
