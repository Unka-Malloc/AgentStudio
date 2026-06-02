# Email Rules Map

Primary files:

- `$PACT_SERVER_DATA_DIR/rules/email-rules.json`
- `server/platform/specialized/knowledge/preprocessing/domain/rules/email-rules.mjs`
- `server/platform/specialized/knowledge/preprocessing/domain/rules/index.mjs`
- `server/platform/specialized/knowledge/preprocessing/domain/rules/email-analysis.mjs`

Typical rule areas:

- report series
- synonyms
- department aliases
- person aliases
- stop words
- transaction merge thresholds
- stale and retrieval windows

Maintenance workflow:

1. Back up the current JSON.
2. Make a focused rule change.
3. Run a known mail sample through the server.
4. Compare transaction count, people count, associations, and warnings.
5. Keep a before/after result JSON when changing merge behavior.
