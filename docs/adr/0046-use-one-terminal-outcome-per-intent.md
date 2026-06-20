# Use One Terminal Outcome per Intent

Each Operation Intent has at most one Terminal Outcome. Retries, repairs, and compensations create new Operation Intents linked by causality references, which keeps lifecycle verification simple and avoids reopening or mutating closed intents.
