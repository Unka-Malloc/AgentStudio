# Idempotency Replay Does Not Append Ledger Facts

Pactium idempotency replay will return the existing intent or outcome proof reference and mark the result as replayed instead of appending another Ledger fact. Retries should recover prior verifiable lifecycle facts, not create duplicate operation history.
