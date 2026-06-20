# Idempotency Replay Does Not Append Ledger Facts

Pactium idempotency replay returns the existing intent or outcome proof reference and marks the result as replayed instead of appending another Ledger fact. Retries should recover prior verifiable lifecycle facts, not create duplicate operation history.
